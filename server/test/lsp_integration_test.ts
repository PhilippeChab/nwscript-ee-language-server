// End-to-end LSP integration test.
//
// Spawns the built server.js as a child process, speaks JSON-RPC to it
// over stdin/stdout exactly like VS Code does, and asserts that
// publishDiagnostics notifications arrive with the expected shape.
//
// Catches anything that breaks in real LSP usage that the unit-level
// WASM tests can't see: server boot, document indexing, didOpen /
// didChange handling, the connection.sendDiagnostics path, file-system
// resolution from a real workspace.

import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { ChildProcess, spawn } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

// Default LSP-side config we hand back on workspace/configuration. Keep
// in sync with the server's defaultServerConfiguration shape (the
// destructuring in loadConfig() will throw on a missing key).
const DEFAULT_LSP_CONFIG = {
  completion: { addParamsToFunctions: false },
  hovering: { addCommentsToFunctions: false },
  formatter: {
    enabled: false, verbose: false, executable: "clang-format",
    ignoredGlobs: [], style: {},
  },
  compiler: {
    enabled: true, os: null, verbose: false, reportWarnings: true,
    nwnHome: "", nwnInstallation: "",
  },
};

class LspClient {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, (msg: JsonRpcMessage) => void>();
  private notifications: JsonRpcMessage[] = [];
  private notificationListeners: ((m: JsonRpcMessage) => void)[] = [];

  constructor(private readonly proc: ChildProcess) {
    proc.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stderr!.on("data", (chunk: Buffer) => {
      if (process.env.LSP_VERBOSE) {
        process.stderr.write(`[server stderr] ${chunk.toString()}`);
      }
    });
    if (process.env.LSP_VERBOSE) {
      this.notificationListeners.push((m) => {
        if (m.method === "window/logMessage" || m.method === "window/showMessage") {
          process.stderr.write(`[server log] ${m.params?.message}\n`);
        }
      });
    }
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString();
      const m = /Content-Length: (\d+)/.exec(header);
      if (!m) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const bodyLen = Number(m[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + bodyLen) return;
      const body = this.buffer.slice(bodyStart, bodyStart + bodyLen).toString();
      this.buffer = this.buffer.slice(bodyStart + bodyLen);
      try {
        const msg = JSON.parse(body) as JsonRpcMessage;
        this.dispatch(msg);
      } catch {
        // ignore
      }
    }
  }

  private dispatch(msg: JsonRpcMessage) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const cb = this.pending.get(msg.id as number);
      if (cb) {
        this.pending.delete(msg.id as number);
        cb(msg);
      }
    } else if (msg.method) {
      if (msg.id !== undefined) {
        this.send({ jsonrpc: "2.0", id: msg.id, result: this.replyTo(msg) });
      } else {
        this.notifications.push(msg);
        for (const fn of this.notificationListeners) fn(msg);
      }
    }
  }

  /** Default replies for server-initiated requests. */
  private replyTo(msg: JsonRpcMessage): any {
    if (msg.method === "workspace/configuration") {
      // Return one object per requested section. The server unwraps a
      // single-section getConfiguration() to result[0], so each item
      // must be the full default config or destructuring blows up.
      const items = msg.params?.items ?? [];
      return items.map(() => DEFAULT_LSP_CONFIG);
    }
    if (msg.method === "window/workDoneProgress/create") return null;
    if (msg.method === "client/registerCapability") return null;
    if (msg.method === "client/unregisterCapability") return null;
    return null;
  }

  private send(msg: JsonRpcMessage) {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.proc.stdin!.write(header + body);
  }

  request(method: string, params: any): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: any) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /**
   * Wait for the next publishDiagnostics matching `uri`. Resolves with
   * the diagnostics array once one arrives. Times out after `ms`.
   */
  waitForDiagnostics(uri: string, ms = 5000): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const matchInPast = this.notifications.find(
        (n) => n.method === "textDocument/publishDiagnostics" && n.params?.uri === uri
      );
      if (matchInPast) {
        return resolve(matchInPast.params.diagnostics as any[]);
      }
      const timer = setTimeout(() => {
        const idx = this.notificationListeners.indexOf(handler);
        if (idx >= 0) this.notificationListeners.splice(idx, 1);
        reject(new Error(`Timed out waiting for diagnostics on ${uri}`));
      }, ms);
      const handler = (n: JsonRpcMessage) => {
        if (n.method === "textDocument/publishDiagnostics" && n.params?.uri === uri) {
          clearTimeout(timer);
          const idx = this.notificationListeners.indexOf(handler);
          if (idx >= 0) this.notificationListeners.splice(idx, 1);
          resolve(n.params.diagnostics as any[]);
        }
      };
      this.notificationListeners.push(handler);
    });
  }

  clearNotifications() {
    this.notifications = [];
  }
}

describe("LSP integration via JSON-RPC", function () {
  // The server boots a child cluster for indexing - give it a window.
  this.timeout(30000);

  let workspace: string;
  let proc: ChildProcess;
  let client: LspClient;

  const NWSCRIPT_NSS = `
int Nonsense(int n);
int IntFn(int n);
string StringFn(string s);
void VoidFn();
`.trim();

  before("set up workspace and start server", async () => {
    workspace = mkdtempSync(join(tmpdir(), "nwscript-lsp-"));
    writeFileSync(join(workspace, "nwscript.nss"), NWSCRIPT_NSS);

    const serverPath = join(__dirname, "..", "out", "server.js");
    proc = spawn("node", [serverPath, "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: workspace,
    });
    client = new LspClient(proc);

    const initResp = await client.request("initialize", {
      processId: process.pid,
      rootPath: workspace,
      rootUri: pathToFileURL(workspace).href,
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          synchronization: { didSave: true, willSave: false, dynamicRegistration: false },
        },
        workspace: {
          workspaceFolders: true,
          configuration: true,
        },
        window: {
          workDoneProgress: true,
        },
      },
      workspaceFolders: [{ uri: pathToFileURL(workspace).href, name: "test" }],
    });
    expect(initResp.result?.capabilities).to.exist;

    client.notify("initialized", {});

    // Give the indexer cluster a moment to finish (configLoaded gates
    // diagnostic publish). 1.5s is comfortable on cold hardware.
    await new Promise((r) => setTimeout(r, 1500));
  });

  after("shut down", async () => {
    if (proc && !proc.killed) {
      try {
        await client.request("shutdown", null);
        client.notify("exit", null);
      } catch { /* ignore */ }
      proc.kill();
    }
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  function openDocument(name: string, content: string): string {
    const path = join(workspace, name);
    writeFileSync(path, content);
    const uri = pathToFileURL(path).href;
    client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "nwscript", version: 1, text: content },
    });
    return uri;
  }

  function changeDocument(uri: string, content: string, version = 2) {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
  }

  /**
   * The LSP only re-runs diagnostics on save (or open), not on every
   * change - so for tests that exercise an edit-then-rediagnose flow,
   * we have to follow up with a didSave too.
   */
  function saveDocument(uri: string, content: string) {
    client.notify("textDocument/didSave", {
      textDocument: { uri },
      text: content,
    });
  }

  it("publishes empty diagnostics for a clean file", async () => {
    const uri = openDocument("clean.nss", "void main() { int x = 1 + 2; }");
    const diags = await client.waitForDiagnostics(uri);
    expect(diags).to.have.lengthOf(0);
  });

  it("publishes a type-error diagnostic on a broken file", async () => {
    const uri = openDocument("broken.nss", 'void main() { int x = "wrong"; }');
    const diags = await client.waitForDiagnostics(uri);
    expect(diags.length).to.be.at.least(1);
    expect(diags[0].message).to.include("MISMATCHED TYPES");
    expect(diags[0].severity).to.equal(1); // Error
  });

  it("publishes multiple diagnostics in one pass", async () => {
    const uri = openDocument("multi.nss",
      'void main() { int x = "a"; int y = "b"; int z = "c"; }');
    const diags = await client.waitForDiagnostics(uri);
    expect(diags.length).to.be.at.least(3);
  });

  it("validates an include-only file (no main) without complaint", async () => {
    const uri = openDocument("inc_helper.nss",
      "int helper(int n) { return n * 2; }");
    const diags = await client.waitForDiagnostics(uri);
    expect(diags).to.have.lengthOf(0);
  });

  it("clears diagnostics after the user fixes and saves the source", async () => {
    const path = join(workspace, "editing.nss");
    const uri = openDocument("editing.nss",
      'void main() { int x = "wrong"; }');
    const broken = await client.waitForDiagnostics(uri);
    expect(broken.length).to.be.at.least(1);

    client.clearNotifications();
    const fixedContent = "void main() { int x = 1; }";
    changeDocument(uri, fixedContent);
    // The diagnostic provider reads from disk, so the saved file must
    // actually reflect the new content before the save event fires.
    writeFileSync(path, fixedContent);
    saveDocument(uri, fixedContent);
    const fixed = await client.waitForDiagnostics(uri);
    expect(fixed).to.have.lengthOf(0);
  });

  it("survives many compiles with deeply chained includes", async () => {
    // Earlier the diagnostics provider double-freed the resolver's
    // delivery buffer once per #include, corrupting the WASM heap.
    // It usually surfaced two-or-three compiles later as "memory
    // access out of bounds". Trigger a long include chain repeatedly
    // and make sure no compile crashes.
    writeFileSync(join(workspace, "leaf.nss"),
      "const int LEAF_VAL = 1;");
    writeFileSync(join(workspace, "mid.nss"),
      '#include "leaf"\nconst int MID_VAL = 2;');
    writeFileSync(join(workspace, "root_inc.nss"),
      '#include "mid"\nconst int ROOT_VAL = 3;');
    const uri = openDocument("uses_chain.nss",
      '#include "root_inc"\nvoid main() { int x = LEAF_VAL + MID_VAL + ROOT_VAL; }');

    // First publish
    let diags = await client.waitForDiagnostics(uri);
    expect(diags).to.have.lengthOf(0);

    // Resave a bunch of times - any heap corruption would show up
    // here as a sendDiagnostics with a "memory access out of bounds"
    // error message OR no diagnostics arriving at all.
    for (let i = 0; i < 10; i++) {
      client.clearNotifications();
      saveDocument(uri,
        '#include "root_inc"\nvoid main() { int x = LEAF_VAL + MID_VAL + ROOT_VAL; }');
      diags = await client.waitForDiagnostics(uri, 3000);
      expect(diags).to.have.lengthOf(0,
        `iter ${i}: expected clean compile, got: ${JSON.stringify(diags)}`);
    }
  });

  it("routes errors in #include'd files to the include's URI", async () => {
    const libUri = openDocument("buggy_lib.nss",
      "int helper() { return BadId(); }");
    // Open a main that uses the broken lib. The compiler should report
    // lib's error - either against the lib's URI or against main's,
    // depending on how the LSP routes it.
    const mainUri = openDocument("main_using_lib.nss",
      '#include "buggy_lib"\nvoid main() { int x = helper(); }');

    // Wait briefly for both files' diagnostics to settle.
    const allDiags = await Promise.race([
      Promise.all([
        client.waitForDiagnostics(libUri, 3000),
        client.waitForDiagnostics(mainUri, 3000),
      ]),
      new Promise<any[][]>((r) => setTimeout(() => r([[], []]), 3500)),
    ]);
    const flat = allDiags.flat();
    const messages = flat.map((d: any) => d.message).join("\n");
    expect(flat.length).to.be.at.least(1, `expected some diagnostic, got: ${messages}`);
  });
});
