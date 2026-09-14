import { before, beforeEach, after, afterEach, describe, it } from "mocha";
import { expect } from "chai";
import { execFileSync, fork } from "child_process";
import { once } from "events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir, cpus } from "os";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  DidOpenTextDocumentNotification,
  DidChangeConfigurationNotification,
  HoverRequest,
  DefinitionRequest,
  CompletionRequest,
  DocumentFormattingRequest,
  DocumentSymbolRequest,
  DidSaveTextDocumentNotification,
  DidChangeTextDocumentNotification,
  MarkupKind,
  ResponseError,
  ErrorCodes,
  type Hover,
  type MarkupContent,
} from "vscode-languageserver/node";
import { packageStandalone } from "../scripts/PackageStandalone";
import { runNpm } from "../scripts/Npm";
import { LspClient, ClientOptions } from "./support/LspClient";
import type { IndexerMessage } from "../src/Documents/DocumentsIndexer";

// Test the installed artifact through standard LSP. No editor-specific protocol
// or source-tree imports are used by the launched server.
describe("Installed standalone LSP server", function () {
  this.timeout(20000);
  let temporary: string;
  let packageRoot: string;
  let cli: string;
  let workspace: string;
  let clients: LspClient[];
  const root = resolve(__dirname, "../..");
  const source = '#include "helper"\nvoid main() { Helper( "bad" ); }\n';
  const helper = "// Helper documentation\nint Helper(int n);\nint Helper(int n) { return n; }\n";
  const position = { line: 1, character: 16 };
  const formatter = process.env.CLANG_FORMAT || "clang-format";

  before(function () {
    this.timeout(60000);
    const archive = packageStandalone();
    temporary = mkdtempSync(join(tmpdir(), "nwscript package & spaces "));
    const install = join(temporary, "install");
    mkdirSync(install);
    runNpm(["install", "--prefix", install, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", archive], temporary);
    packageRoot = join(install, "node_modules", "nwscript-ee-language-server");
    cli = join(packageRoot, "bin", "nwscript-ee-language-server.cjs");
  });
  beforeEach(() => {
    clients = [];
    workspace = mkdtempSync(join(temporary, "workspace "));
    writeFileSync(join(workspace, "helper.nss"), helper);
    writeFileSync(join(workspace, "sample.nss"), source);
  });
  afterEach(async () => {
    await Promise.all(clients.map(async (client) => await client.dispose()));
  });
  after(() => {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  });

  async function start(options: ClientOptions = {}) {
    const client = new LspClient(options.ipc ? join(packageRoot, "server/out/server.js") : cli, temporary, { initializationOptions: { compiler: { enabled: false } }, ...options });
    clients.push(client);
    await client.initialize(workspace);
    return client;
  }
  function params() {
    return { textDocument: { uri: pathToFileURL(join(workspace, "sample.nss")).href }, position };
  }
  async function open(client: LspClient) {
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: params().textDocument.uri, languageId: "nwscript", version: 1, text: source } });
  }
  function content(hover: Hover | null) {
    return hover?.contents as MarkupContent | undefined;
  }
  async function features(client: LspClient) {
    expect(JSON.stringify(await client.rpc.sendRequest(CompletionRequest.type, params()))).to.include("Helper");
    expect(JSON.stringify(await client.rpc.sendRequest(HoverRequest.type, params()))).to.include("Helper");
    expect(JSON.stringify(await client.rpc.sendRequest(DefinitionRequest.type, params()))).to.include("helper.nss");
  }

  it("installs an executable with the extension version and all runtime resources/licenses", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    expect(execFileSync(process.execPath, [cli, "--version"], { cwd: temporary, encoding: "utf8" }).trim()).to.equal(manifest.version);
    expect(execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" })).to.include("--stdio");
    const compare = (relative: string) => {
      for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
        const file = join(relative, entry.name);
        if (entry.isDirectory()) compare(file);
        else expect(readFileSync(join(packageRoot, file)).equals(readFileSync(join(root, file))), file).to.equal(true);
      }
    };
    compare("server/resources");
    compare("syntaxes");
    expect(existsSync(join(packageRoot, "third-party/vscode-oniguruma/LICENSE.txt"))).to.equal(true);
    const executable = join(packageRoot, "..", ".bin", process.platform === "win32" ? "nwscript-ee-language-server.cmd" : "nwscript-ee-language-server");
    expect(existsSync(executable)).to.equal(true);
    if (process.platform !== "win32") expect(execFileSync(executable, ["--version"], { encoding: "utf8" }).trim()).to.equal(manifest.version);
  });

  it("serves immediate requests with no optional capabilities and defaults to stdio", async () => {
    const client = await start({ defaultTransport: true });
    await open(client); // Deliberately do not wait for background indexing.
    await features(client);
    expect(content(await client.rpc.sendRequest(HoverRequest.type, params()))?.kind).to.equal(MarkupKind.PlainText);
    const symbols = await client.rpc.sendRequest(DocumentSymbolRequest.type, { textDocument: params().textDocument });
    expect(symbols?.[0]).to.have.property("location");
    expect(client.requests).to.deep.equal([]);
    await client.ready();
    await client.shutdown();
  });

  it("supports the VS Code IPC transport with background indexing and clean shutdown", async () => {
    const client = await start({ ipc: true, capabilities: { workspace: { configuration: true } }, configuration: () => ({ compiler: { enabled: false } }) });
    await client.ready();
    await open(client);
    await features(client);
    await client.shutdown();
  });

  it("preserves include selection when an unselected duplicate is opened and saved", async () => {
    const duplicate = join(workspace, "duplicate", "helper.nss");
    mkdirSync(join(workspace, "duplicate"));
    writeFileSync(duplicate, "float Helper(float n);\n");
    const client = await start();
    await client.ready();
    await open(client);
    const definition = await client.rpc.sendRequest(DefinitionRequest.type, params());
    const hover = await client.rpc.sendRequest(HoverRequest.type, params());
    const candidates = [join(workspace, "helper.nss"), duplicate];
    const selected = candidates.find((path) => JSON.stringify(definition).includes(pathToFileURL(path).href));
    const unselected = candidates.find((path) => !JSON.stringify(definition).includes(pathToFileURL(path).href));
    if (!selected || !unselected) throw new Error("Expected a selected include and an unselected duplicate");
    const uri = pathToFileURL(unselected).href;
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text: readFileSync(unselected, "utf8") } });
    expect(await client.rpc.sendRequest(DefinitionRequest.type, params())).to.deep.equal(definition);
    expect(await client.rpc.sendRequest(HoverRequest.type, params())).to.deep.equal(hover);
    const changed = "string Helper(string n);\n";
    writeFileSync(unselected, changed);
    await client.rpc.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri, version: 2 }, contentChanges: [{ text: changed }] });
    await client.rpc.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: { uri } });
    expect(await client.rpc.sendRequest(DefinitionRequest.type, params())).to.deep.equal(definition);
    expect(await client.rpc.sendRequest(HoverRequest.type, params())).to.deep.equal(hover);
    const ownHover = await client.rpc.sendRequest(HoverRequest.type, { textDocument: { uri }, position: { line: 0, character: 9 } });
    expect(content(ownHover)?.value).to.include("string Helper(string n)");
    const selectedUri = pathToFileURL(selected).href;
    const updated = "int Helper(int updatedParameter);\n";
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: selectedUri, languageId: "nwscript", version: 1, text: readFileSync(selected, "utf8") } });
    writeFileSync(selected, updated);
    await client.rpc.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri: selectedUri, version: 2 }, contentChanges: [{ text: updated }] });
    await client.rpc.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: { uri: selectedUri } });
    expect(content(await client.rpc.sendRequest(HoverRequest.type, params()))?.value).to.include("int Helper(int updatedParameter)");
    await client.shutdown();
  });

  it("recovers a repaired include when its already-indexed parent is opened", async () => {
    writeFileSync(join(workspace, "helper.nss"), "int Broken(");
    const client = await start();
    await client.ready();
    expect(client.logs.some((log) => log.includes("Cannot index") && log.includes("helper.nss"))).to.equal(true);
    writeFileSync(join(workspace, "helper.nss"), helper);
    await open(client);
    await features(client);
    await client.shutdown();
  });

  it("removes deleted formatter style options from full configuration responses", async () => {
    let settings: unknown = { formatter: { style: { SpaceBeforeParens: "Always" } } };
    const client = await start({
      initializationOptions: { compiler: { enabled: false }, formatter: { enabled: true, executable: formatter } },
      capabilities: { workspace: { configuration: true } },
      configuration: () => settings,
    });
    await client.ready();
    await open(client);
    const format = async () => {
      const edits = await client.rpc.sendRequest(DocumentFormattingRequest.type, { textDocument: params().textDocument, options: { tabSize: 4, insertSpaces: true } });
      return TextDocument.applyEdits(TextDocument.create(params().textDocument.uri, "nwscript", 1, source), edits || []);
    };
    expect(await format()).to.include("Helper (");
    settings = { formatter: { style: {} }, hovering: { addCommentsToFunctions: true } };
    await client.rpc.sendNotification(DidChangeConfigurationNotification.type, { settings: {} });
    let applied = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      applied = content(await client.rpc.sendRequest(HoverRequest.type, params()))?.value.includes("Helper documentation") === true;
      if (applied) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    expect(applied).to.equal(true);
    expect(await format()).to.include("Helper(");
    await client.shutdown();
  });

  it("negotiates Markdown, hierarchical symbols, configuration and progress", async () => {
    const client = await start({
      capabilities: {
        textDocument: { hover: { contentFormat: [MarkupKind.Markdown] }, documentSymbol: { hierarchicalDocumentSymbolSupport: true } },
        workspace: { configuration: true, workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: true } },
        window: { workDoneProgress: true },
      },
      configuration: () => ({ compiler: { enabled: false }, hovering: { addCommentsToFunctions: true } }),
    });
    await client.ready();
    await open(client);
    expect(content(await client.rpc.sendRequest(HoverRequest.type, params()))).to.include({ kind: MarkupKind.Markdown });
    expect(content(await client.rpc.sendRequest(HoverRequest.type, params()))?.value).to.include("Helper documentation");
    const symbols = await client.rpc.sendRequest(DocumentSymbolRequest.type, { textDocument: params().textDocument });
    expect(symbols?.[0]).to.have.property("selectionRange");
    const helperUri = pathToFileURL(join(workspace, "helper.nss")).href;
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: helperUri, languageId: "nwscript", version: 1, text: helper } });
    const helperSymbols = await client.rpc.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri: helperUri } });
    for (const symbol of helperSymbols || []) {
      if ("children" in symbol) {
        for (const child of symbol.children || []) {
          expect(child.range.end.line <= symbol.range.end.line).to.equal(true);
          if (child.range.end.line === symbol.range.end.line) expect(child.range.end.character <= symbol.range.end.character).to.equal(true);
        }
      }
    }
    await features(client);
    expect(client.requests).to.include.members(["workspace/configuration", "client/registerCapability", "window/workDoneProgress/create"]);
    await client.shutdown();
  });

  for (const legacyRoot of [false, true]) {
    it(`handles ${legacyRoot ? "legacy rootPath" : "rootless initialization"}`, async () => {
      const client = await start(legacyRoot ? { legacyRoot } : { root: null });
      await client.ready();
      await open(client);
      expect(await client.rpc.sendRequest(CompletionRequest.type, params())).not.to.equal(null);
      await client.shutdown();
    });
  }

  it("continues after rejected optional client requests", async () => {
    const reject = () => {
      throw new ResponseError(ErrorCodes.MethodNotFound, "Client feature unavailable");
    };
    const client = await start({
      capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } }, window: { workDoneProgress: true } },
      configuration: reject,
      registration: reject,
      progress: reject,
    });
    await client.ready();
    await open(client);
    await features(client);
    expect(client.logs.filter((log) => log.includes("Client feature unavailable"))).to.have.length(3);
    await client.shutdown();
  });

  it("bounds unanswered requests and still starts indexing", async () => {
    const never = async () => await new Promise<null>(() => {});
    const client = await start({
      capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } },
      configuration: never,
      registration: never,
    });
    await open(client);
    await features(client);
    await client.ready();
    expect(client.logs.filter((log) => log.includes("timed out"))).to.have.length(2);
    await client.shutdown();
  });

  it("shuts down promptly while waiting for a client configuration response", async () => {
    const client = await start({ capabilities: { workspace: { configuration: true } }, configuration: async () => await new Promise<null>(() => {}) });
    await client.waitFor(() => client.requests.includes("workspace/configuration"));
    const began = Date.now();
    await client.shutdown();
    expect(Date.now() - began).to.be.lessThan(2000);
    expect(client.logs.some((log) => log.startsWith("Indexing"))).to.equal(false);
  });

  it("shuts down while a progress request is unanswered", async () => {
    const client = await start({ capabilities: { window: { workDoneProgress: true } }, progress: async () => await new Promise<null>(() => {}) });
    await client.waitFor(() => client.requests.includes("window/workDoneProgress/create"));
    await client.shutdown();
    expect(client.logs.some((log) => log.startsWith("Indexing"))).to.equal(false);
  });

  it("does not let a delayed configuration response overwrite a newer update", async () => {
    let release: ((settings: unknown) => void) | undefined;
    let requests = 0;
    const client = await start({
      capabilities: { workspace: { configuration: true } },
      configuration: async () =>
        ++requests === 1
          ? await new Promise<unknown>((resolve) => {
              release = resolve;
            })
          : { hovering: { addCommentsToFunctions: true } },
    });
    await client.waitFor(() => release !== undefined);
    await client.rpc.sendNotification(DidChangeConfigurationNotification.type, { settings: {} });
    await client.waitFor(() => requests === 2);
    await open(client);
    release?.({ hovering: { addCommentsToFunctions: false } });
    await client.ready();
    expect(content(await client.rpc.sendRequest(HoverRequest.type, params()))?.value).to.include("Helper documentation");
    await client.shutdown();
  });

  it("applies a late configuration response after startup has timed out", async () => {
    let release: ((settings: unknown) => void) | undefined;
    const client = await start({
      capabilities: { workspace: { configuration: true } },
      configuration: async () =>
        await new Promise<unknown>((resolve) => {
          release = resolve;
        }),
    });
    await client.ready();
    expect(client.logs.some((log) => log.includes("timed out"))).to.equal(true);
    await open(client);
    release?.({ hovering: { addCommentsToFunctions: true } });
    // Receiving a response and applying it is asynchronous on the server.
    let hover = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      hover = content(await client.rpc.sendRequest(HoverRequest.type, params()))?.value || "";
      if (hover.includes("Helper documentation")) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    expect(hover).to.include("Helper documentation");
    await client.shutdown();
  });

  it("revalidates open documents when valid compiler paths arrive after the startup timeout", async () => {
    mkdirSync(join(workspace, "lang/en"), { recursive: true });
    mkdirSync(join(workspace, "ovr"));
    writeFileSync(join(workspace, "databuild.txt"), "test\n");
    writeFileSync(join(workspace, "ovr/nwscript.nss"), "int IntFn(int n);\n");
    let release: ((settings: unknown) => void) | undefined;
    const client = await start({
      initializationOptions: { compiler: { enabled: true, nwnHome: join(workspace, "missing"), nwnInstallation: join(workspace, "missing") } },
      capabilities: { workspace: { configuration: true } },
      configuration: async () =>
        await new Promise<unknown>((resolve) => {
          release = resolve;
        }),
    });
    await open(client);
    await client.ready();
    expect(client.logs.some((log) => log.includes("timed out"))).to.equal(true);
    await client.waitFor(() => client.logs.some((log) => log.includes("Previous diagnostics have been retained")));
    expect(client.diagnostics).to.have.length(0);
    release?.({ compiler: { nwnHome: workspace, nwnInstallation: workspace } });
    // No edit, save, or reopen: applying the late settings must trigger validation.
    await client.waitFor(
      () => client.diagnostics.some((item) => item.uri === params().textDocument.uri && item.diagnostics.some((diagnostic) => diagnostic.message.includes("DECLARATION DOES NOT MATCH PARAMETERS"))),
      3000,
    );
    await client.shutdown();
  });

  it("indexes comma-containing paths and continues past individual file failures", async () => {
    const directory = join(workspace, "comma, directory");
    mkdirSync(directory);
    const filePath = join(directory, "helper.nss");
    writeFileSync(filePath, helper);
    const child = fork(join(packageRoot, "server/out/indexer.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const messages: IndexerMessage[] = [];
    const closed = once(child, "close");
    child.on("message", (message: IndexerMessage) => messages.push(message));
    child.send([join(directory, "missing.nss"), filePath]);
    const [code] = await closed;
    expect(code).to.equal(0);
    expect(messages[0].error).to.include("ENOENT");
    expect(messages[1].filePath).to.equal(filePath);
    expect(messages[1].globalScope?.complexTokens.some((token) => token.identifier === "Helper")).to.equal(true);
    const client = await start();
    await client.ready();
    expect(client.logs).to.include("Indexed 3 files.");
    await open(client);
    await features(client);
    await client.shutdown();
  });

  it("waits for active indexing workers to exit during shutdown", async () => {
    const indexer = join(packageRoot, "server/out/indexer.js");
    const original = readFileSync(indexer);
    const pidDirectory = join(workspace, "workers");
    mkdirSync(pidDirectory);
    try {
      writeFileSync(indexer, `require("fs").writeFileSync(require("path").join(${JSON.stringify(pidDirectory)}, process.pid + ".pid"), String(process.pid)); setInterval(() => {}, 1000);`);
      const client = await start();
      await client.waitFor(() => readdirSync(pidDirectory).length > 0);
      const pids = readdirSync(pidDirectory).map((file) => Number(readFileSync(join(pidDirectory, file), "utf8")));
      await client.shutdown();
      for (const pid of pids) expect(() => process.kill(pid, 0)).to.throw();
    } finally {
      writeFileSync(indexer, original);
    }
  });

  it("stops owned indexing workers when the stdio client disconnects without shutdown", async () => {
    const indexer = join(packageRoot, "server/out/indexer.js");
    const original = readFileSync(indexer);
    const pidDirectory = join(workspace, "workers");
    mkdirSync(pidDirectory);
    let pids: number[] = [];
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      writeFileSync(indexer, `require("fs").writeFileSync(require("path").join(${JSON.stringify(pidDirectory)}, process.pid + ".pid"), String(process.pid)); setInterval(() => {}, 1000);`);
      const client = await start();
      await client.waitFor(() => readdirSync(pidDirectory).length === Math.min(2, cpus().length || 1));
      pids = readdirSync(pidDirectory).map((file) => Number(readFileSync(join(pidDirectory, file), "utf8")));
      const closed = once(client.child, "close");
      client.child.stdin.end();
      await closed;
      for (let attempt = 0; attempt < 50 && pids.some(alive); attempt++) await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(pids.filter(alive)).to.deep.equal([]);
    } finally {
      for (const pid of pids) if (alive(pid)) process.kill(pid);
      writeFileSync(indexer, original);
    }
  });

  it("keeps opened documents usable when an indexing worker exits unexpectedly", async () => {
    const indexer = join(packageRoot, "server/out/indexer.js");
    const original = readFileSync(indexer);
    try {
      writeFileSync(indexer, "process.exit(1);\n");
      const client = await start();
      await client.ready();
      expect(client.logs.some((log) => log.includes("Indexer exited with code 1"))).to.equal(true);
      await open(client);
      await features(client);
      await client.shutdown();
    } finally {
      writeFileSync(indexer, original);
    }
  });

  it("retains defaults for null configuration and accepts pushed updates and malformed values", async () => {
    const client = await start({ initializationOptions: { "nwscript-ee-lsp": { compiler: { enabled: false } } } });
    await client.ready();
    await open(client);
    await client.rpc.sendNotification(DidChangeConfigurationNotification.type, { settings: { "nwscript-ee-lsp": { hovering: { addCommentsToFunctions: true }, formatter: { ignoredGlobs: [5] } } } });
    expect(content(await client.rpc.sendRequest(HoverRequest.type, params()))?.value).to.include("Helper documentation");
    await client.rpc.sendNotification(DidChangeConfigurationNotification.type, { settings: null });
    await features(client);
    await client.shutdown();
    const nullClient = await start({ capabilities: { workspace: { configuration: true } }, configuration: () => null });
    await nullClient.ready();
    await open(nullClient);
    await features(nullClient);
    await nullClient.shutdown();
  });

  for (const autoImport of [true, false]) {
    it(`completes earlier code while a trailing declaration is unfinished (autoImport=${String(autoImport)})`, async () => {
      const client = await start({ initializationOptions: { compiler: { enabled: false }, completion: { autoImport } } });
      await client.ready();
      await open(client);
      for (const [index, suffix] of ["void Unfinished(", "void Unfinished(\n int value,\n", "void Unfinished();"].entries()) {
        await client.rpc.sendNotification(DidChangeTextDocumentNotification.type, {
          textDocument: { ...params().textDocument, version: index + 2 },
          contentChanges: [{ text: source + suffix }],
        });
        const response = await client.rpc.sendRequest(CompletionRequest.type, params());
        expect(response, suffix).not.to.equal(null);
        const items = Array.isArray(response) ? response : response?.items || [];
        expect(
          items.some((item) => item.label === "Helper"),
          suffix,
        ).to.equal(true);
        expect(items.find((item) => item.label === "Helper")).not.to.have.property("additionalTextEdits");
      }
      await client.shutdown();
    });
  }

  it("indexes edits made between willSave and didSave instead of reusing an older version", async () => {
    const client = await start();
    await client.ready();
    await open(client);
    await client.rpc.sendNotification("textDocument/willSave", { textDocument: params().textDocument, reason: 1 });
    // Created after background indexing, so only the updated parent's include
    // traversal can make this new function available.
    writeFileSync(join(workspace, "later.nss"), "int LaterFunction();\n");
    const changed = '#include "later"\n' + source;
    writeFileSync(join(workspace, "sample.nss"), changed);
    await client.rpc.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { ...params().textDocument, version: 2 }, contentChanges: [{ text: changed }] });
    await client.rpc.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: params().textDocument });
    const completion = await client.rpc.sendRequest(CompletionRequest.type, { ...params(), position: { line: 2, character: 16 } });
    expect(JSON.stringify(completion)).to.include("LaterFunction");
    await client.shutdown();
  });

  it("provides native diagnostics and clears them on save without willSave support", async () => {
    mkdirSync(join(workspace, "lang/en"), { recursive: true });
    mkdirSync(join(workspace, "ovr"));
    writeFileSync(join(workspace, "databuild.txt"), "test\n");
    writeFileSync(join(workspace, "ovr/nwscript.nss"), "int IntFn(int n);\n");
    const client = await start({ initializationOptions: { compiler: { enabled: true, nwnHome: workspace, nwnInstallation: workspace } } });
    await open(client);
    await client.waitFor(() => client.diagnostics.some((item) => item.uri === params().textDocument.uri && item.diagnostics.length > 0));
    const diagnostics = client.diagnostics.find((item) => item.uri === params().textDocument.uri && item.diagnostics.length > 0)?.diagnostics || [];
    expect(diagnostics).to.have.length.greaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.range.start).to.deep.equal({ line: 1, character: 0 });
      expect(diagnostic.range.end).to.deep.equal({ line: 1, character: source.split("\n")[1].length });
    }
    const fixed = source.replace('"bad"', "42");
    writeFileSync(join(workspace, "sample.nss"), fixed);
    await client.rpc.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { ...params().textDocument, version: 2 }, contentChanges: [{ text: fixed }] });
    await client.rpc.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: params().textDocument });
    await client.waitFor(() => client.diagnostics.some((item) => item.uri === params().textDocument.uri && item.diagnostics.length === 0));
    await client.shutdown();
  });

  it("formats through the configured executable and reports a missing formatter", async () => {
    const client = await start({ initializationOptions: { compiler: { enabled: false }, formatter: { enabled: true, executable: formatter } } });
    await open(client);
    const formatting = { textDocument: params().textDocument, options: { tabSize: 4, insertSpaces: true } };
    expect(await client.rpc.sendRequest(DocumentFormattingRequest.type, formatting)).to.have.length.greaterThan(0);
    await client.rpc.sendNotification(DidChangeConfigurationNotification.type, { settings: { formatter: { executable: join(temporary, "missing-clang-format") } } });
    await client.rpc.sendRequest(DocumentFormattingRequest.type, formatting);
    expect(client.logs.some((log) => log.includes("Install clang-format"))).to.equal(true);
    await client.shutdown();
  });
});
