import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";

import { ServerManager } from "../ServerManager";
import Provider from "./Provider";

// Resource type IDs the NWN script compiler API expects.
const RT_NSS = 2009;
const RT_NCS = 2010;
const RT_NDB = 2064;

// Diagnostic line format from the compiler:
//   filename.nss(line): ERROR: MESSAGE [optional context]
// or, for some errors with no line attached:
//   filename.nss: ERROR: MESSAGE
const LINE_RE = /^(?<file>[^()]+?)(?:\((?<line>\d+)\))?:\s*ERROR:\s*(?<message>.+?)\s*$/m;

type FilesDiagnostics = { [uri: string]: Diagnostic[] };

export default class DiagnoticsProvider extends Provider {
  private modulePromise: Promise<any> | null = null;
  // {scriptName -> absolutePath} for stock NWN scripts found under the
  // configured nwnHome / nwnInstallation directories. Built lazily on
  // first miss in the workspace, then reused. Old nwnsc resolved these
  // automatically by reading the BIF/KEY archives; we instead look at
  // the directories Beamdog ships extracted.
  private nwnScriptIndex: Map<string, string> | null = null;

  constructor(server: ServerManager) {
    super(server);
  }

  /** Load the WASM module exactly once. */
  private async getModule(): Promise<any> {
    if (!this.modulePromise) {
      // server.js is bundled into server/out/, so server/wasm is one
      // level up from __dirname. (The same path also works for the
      // un-bundled ts-node compile from server/src/Providers/, where
      // ../wasm reaches server/wasm.)
      const wasmPath = join(__dirname, "..", "wasm", "nwscript_compiler.js");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NWScriptCompiler = require(wasmPath);
      this.modulePromise = NWScriptCompiler();
    }
    return this.modulePromise;
  }

  /**
   * Walk a directory tree once and return a {scriptName -> absPath} map
   * of every .nss file found. Used to seed the NWN-install fallback
   * index so the resolver can hand the compiler stock scripts that
   * normally live inside Beamdog's BIF archives.
   */
  private indexNssDir(root: string): Map<string, string> {
    const out = new Map<string, string>();
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: string[] = [];
      try { entries = readdirSync(dir); } catch { continue; }
      for (const name of entries) {
        const full = join(dir, name);
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            stack.push(full);
          } else if (st.isFile() && name.toLowerCase().endsWith(".nss")) {
            const key = name.slice(0, -4).toLowerCase();
            // Workspace overrides win, so we don't overwrite an
            // earlier entry. Stock scripts sit under predictable
            // dirs but order doesn't matter much in practice.
            if (!out.has(key)) out.set(key, full);
          }
        } catch { /* skip unreadable entries */ }
      }
    }
    return out;
  }

  /**
   * Build the NWN-install lookup index from configured nwnHome /
   * nwnInstallation directories. Cheap on subsequent calls thanks to
   * caching - if the user changes the config we'll pick up new files
   * by clearing the cache, which we do on every publish.
   */
  private buildNwnScriptIndex(): Map<string, string> {
    const index = new Map<string, string>();
    const { nwnHome, nwnInstallation } = this.server.config.compiler;
    const candidates: string[] = [];
    if (nwnInstallation) {
      // Beamdog's install ships extracted base scripts under
      // data/base_scripts and ovr/. Both are worth indexing.
      candidates.push(join(nwnInstallation, "data"));
      candidates.push(join(nwnInstallation, "ovr"));
    }
    if (nwnHome) {
      // User's per-game scripts and overrides.
      candidates.push(join(nwnHome, "override"));
      candidates.push(join(nwnHome, "development"));
    }
    for (const root of candidates) {
      if (!existsSync(root)) continue;
      for (const [k, v] of this.indexNssDir(root)) {
        if (!index.has(k)) index.set(k, v);
      }
    }
    return index;
  }

  /**
   * Resolve a script name to its source bytes. Tries the workspace
   * first (via the existing glob), then falls back to the NWN install
   * index for stock includes like x0_i0_stringlib.
   */
  private resolveScriptSource(name: string): string | null {
    try {
      const ws = this.server.workspaceFilesSystem?.getFilePath(name);
      if (ws) return readFileSync(ws).toString();
    } catch { /* fall through to NWN index */ }

    if (!this.nwnScriptIndex) {
      this.nwnScriptIndex = this.buildNwnScriptIndex();
    }
    const stockPath = this.nwnScriptIndex.get(name.toLowerCase());
    if (!stockPath) return null;
    try {
      return readFileSync(stockPath).toString();
    } catch {
      return null;
    }
  }

  /**
   * Run the WASM compiler over `uri` in collect-all-errors mode and
   * record per-file diagnostics into `files`.
   */
  private async compile(uri: string, files: FilesDiagnostics): Promise<void> {
    const Module = await this.getModule();

    const filePath = fileURLToPath(uri);
    const fileBaseName = basename(filePath, ".nss");

    // The compiler hands us the bare filename (no extension); we map
    // it back to source via the workspace, with the requested document
    // taking precedence over a same-named file elsewhere in the tree.
    const sources: { [name: string]: string } = {};
    sources[fileBaseName] = readFileSync(filePath).toString();

    let compilerPtr = 0;
    let deliveryBuf = 0;
    let loadCb = 0;
    let writeCb = 0;

    try {
      // Resolver: hand the compiler script source, looking it up in
      // our local cache first then in the workspace.
      loadCb = Module.addFunction((fnPtr: number) => {
        try {
          const fn = Module.UTF8ToString(fnPtr);
          let src: string | null = sources[fn] ?? null;
          if (src === null) {
            src = this.resolveScriptSource(fn);
            if (src !== null) sources[fn] = src;
          }
          if (src === null) return 0;

          // Reuse a single buffer per compile; free the previous
          // request's bytes before allocating the next. A previous
          // version pushed every allocation into a list and freed
          // them all at the end of compile, which double-freed every
          // buffer except the last one and corrupted the WASM heap.
          // The corruption only surfaced one or two compiles later
          // as "memory access out of bounds".
          const len = Module.lengthBytesUTF8(src);
          if (deliveryBuf) Module._free(deliveryBuf);
          deliveryBuf = Module._malloc(len + 1);
          Module.stringToUTF8(src, deliveryBuf, len + 1);
          Module._scriptCompApiDeliverFile(compilerPtr, deliveryBuf, len);
          return 1;
        } catch {
          return 0;
        }
      }, "iii");

      // We don't care about output bytes; signal success so the
      // compiler doesn't treat the write as an error.
      writeCb = Module.addFunction(() => 0, "iiiiii");

      const newCompiler = Module.cwrap("scriptCompApiNewCompiler", "number",
        ["number", "number", "number", "number", "number"]);
      const initCompiler = Module.cwrap("scriptCompApiInitCompiler", null,
        ["number", "string", "boolean", "number", "number", "string"]);
      const setCollectAll = Module.cwrap("scriptCompApiSetCollectAllErrors",
        null, ["number", "boolean"]);
      const setRequireEntry = Module.cwrap(
        "scriptCompApiSetRequireEntryPoint", null, ["number", "boolean"]);
      const compile = Module.cwrap("wasmCompile", "number",
        ["number", "string"]);
      const errorCount = Module.cwrap("wasmGetCollectedErrorCount", "number",
        ["number"]);
      const errorAt = Module.cwrap("wasmGetCollectedError", "string",
        ["number", "number"]);
      const lastError = Module.cwrap("wasmGetLastError", "string", ["number"]);

      compilerPtr = newCompiler(RT_NSS, RT_NCS, RT_NDB, writeCb, loadCb);
      if (!compilerPtr) throw new Error("scriptCompApiNewCompiler returned null");

      // writeDebug=false: we don't want NDB output. maxIncludeDepth=16
      // matches the historic compiler default.
      initCompiler(compilerPtr, "nwscript", false, 16, 0, "scriptout");
      setCollectAll(compilerPtr, true);
      // Allow files with no entry point (helper / include scripts) to
      // validate cleanly - the LSP wants diagnostics on every editable
      // file, not just main scripts.
      setRequireEntry(compilerPtr, false);

      compile(compilerPtr, fileBaseName);

      const messages: string[] = [];
      const n = errorCount(compilerPtr);
      for (let i = 0; i < n; i++) {
        messages.push(errorAt(compilerPtr, i));
      }
      // Some hard-fail paths (e.g. file-not-found, lexer panic) bypass
      // the multi-error vector and only report through the captured
      // single-error string. Pick that up too.
      if (messages.length === 0) {
        const single = lastError(compilerPtr);
        if (single) messages.push(single);
      }

      for (const raw of messages) {
        for (const line of raw.split("\n")) {
          const m = LINE_RE.exec(line);
          if (!m) continue;
          this.recordDiagnostic(uri, files, m.groups!);
          break;
        }
      }
    } finally {
      if (compilerPtr) {
        try { Module._scriptCompApiDestroyCompiler(compilerPtr); }
        catch { /* ignore */ }
      }
      if (deliveryBuf) {
        try { Module._free(deliveryBuf); } catch { /* ignore */ }
      }
      if (loadCb) Module.removeFunction(loadCb);
      if (writeCb) Module.removeFunction(writeCb);
    }
  }

  /**
   * Map a parsed diagnostic line to an LSP Diagnostic and stash it
   * under the right URI. Errors raised in #include'd files are routed
   * to that file's URI when we can resolve it; otherwise they're
   * attached to the document we were asked to check.
   */
  private recordDiagnostic(
    targetUri: string,
    files: FilesDiagnostics,
    parts: { [k: string]: string }
  ) {
    const file = (parts.file ?? "").trim();
    const line = Number(parts.line ?? "1");
    const message = (parts.message ?? "").trim();

    let uri = targetUri;
    const base = file.replace(/\.nss$/, "");
    const path = this.server.workspaceFilesSystem?.getFilePath(base);
    if (path) uri = pathToFileURL(path).href;

    if (!files[uri]) files[uri] = [];

    const linePos = Math.max(0, line - 1);
    files[uri].push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: linePos, character: 0 },
        end: { line: linePos, character: Number.MAX_VALUE },
      },
      message,
      source: "nwscript",
    });
  }

  public async publish(uri: string): Promise<boolean> {
    const { enabled, verbose } = this.server.config.compiler;
    if (!enabled || uri.includes("nwscript.nss")) {
      return true;
    }

    const document = this.server.documentsCollection?.getFromUri(uri);
    if (!this.server.configLoaded || !document) {
      if (!this.server.documentsWaitingForPublish.includes(uri)) {
        this.server.documentsWaitingForPublish?.push(uri);
      }
      return true;
    }

    if (verbose) {
      this.server.logger.info(`Compiling ${uri}`);
    }

    // Pre-seed empty diagnostic lists for the target plus all of its
    // transitive includes - so that fixing an error in an include
    // immediately clears any prior squiggle on it.
    const files: FilesDiagnostics = { [uri]: [] };
    for (const child of document.getChildren()) {
      const childUri = this.server.documentsCollection?.get(child)?.uri;
      if (childUri) files[childUri] = [];
    }

    try {
      await this.compile(uri, files);
    } catch (e: any) {
      this.server.logger.error(`Compile failed: ${e?.message ?? e}`);
    }

    for (const [u, diagnostics] of Object.entries(files)) {
      this.server.connection.sendDiagnostics({ uri: u, diagnostics });
    }

    if (verbose) {
      this.server.logger.info("Done.");
    }
    return true;
  }

  public async processDocumentsWaitingForPublish() {
    return await Promise.all(
      this.server.documentsWaitingForPublish.map(async (uri) => await this.publish(uri))
    );
  }
}
