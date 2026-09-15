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
    expect(messages[1].documentTokens?.globalDeclarations.some((token) => token.identifier === "Helper")).to.equal(true);
    const client = await start();
    await client.ready();
    expect(client.logs).to.include("Indexed 3 files.");
    await open(client);
    await features(client);
    await client.shutdown();
  });

  it("resolves a local variable shadowing a global variable in all editor providers", async () => {
    // NWScript permits shadowing global variables; global constants cannot be shadowed.
    const text = 'int VALUE = 1;\nvoid main() {\n string VALUE = "local";\n string result = VALUE;\n}\n';
    const uri = params().textDocument.uri;
    writeFileSync(join(workspace, "sample.nss"), text);
    const client = await start();
    await client.ready();
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
    const request = { textDocument: { uri }, position: { line: 3, character: 19 } };
    const completion: any = await client.rpc.sendRequest(CompletionRequest.type, request);
    const items = completion.items || completion;
    expect(items.filter((item: any) => item.label === "VALUE").map((item: any) => item.detail)).to.deep.equal(["(variable) VALUE: string"]);
    const hover = await client.rpc.sendRequest(HoverRequest.type, request);
    expect(content(hover)?.value).to.include("string VALUE");
    const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, request);
    expect(definition.range.start).to.deep.equal({ line: 2, character: 8 });
    await client.shutdown();
  });

  for (const body of ['string value = "local"; string copy = value;', '\n string value = "local";\n string copy = value;\n', '{ string value = "local"; string copy = value; } int copy = value;']) {
    it(`prefers a body-local declaration over its parameter: ${JSON.stringify(body)}`, async () => {
      const text = `void Fn(int value) { ${body} }`;
      const uri = params().textDocument.uri;
      writeFileSync(join(workspace, "sample.nss"), text);
      const client = await start({ initializationOptions: { compiler: { enabled: false }, completion: { autoImport: false } } });
      await client.ready();
      await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
      const document = TextDocument.create(uri, "nwscript", 1, text);
      const local = text.indexOf("string value") + "string ".length;
      const parameter = text.indexOf("int value") + "int ".length;
      const uses = [
        [text.indexOf("copy = value") + "copy = ".length, local, "string"],
        [parameter, parameter, "int"],
      ] as const;
      for (const [offset, declaration, type] of uses) {
        const request = { textDocument: { uri }, position: document.positionAt(offset + 2) };
        expect(content(await client.rpc.sendRequest(HoverRequest.type, request))?.value).to.equal(`${type} value`);
        const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, request);
        expect(definition.range.start).to.deep.equal(document.positionAt(declaration));
      }
      const request = { textDocument: { uri }, position: document.positionAt(uses[0][0] + 2) };
      const completions: any = await client.rpc.sendRequest(CompletionRequest.type, request);
      expect(completions.filter((item: any) => item.label === "value").map((item: any) => item.detail)).to.deep.equal(["(variable) value: string"]);
      if (body.startsWith("{")) {
        const outside = { textDocument: { uri }, position: document.positionAt(text.lastIndexOf("value") + 2) };
        expect(content(await client.rpc.sendRequest(HoverRequest.type, outside))?.value).to.equal("int value");
        const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, outside);
        expect(definition.range.start).to.deep.equal(document.positionAt(parameter));
      }
      await client.shutdown();
    });
  }

  for (const name of ["VALUE", "value"]) {
    it(`resolves ${name} after a shadowing block ends and hides other functions' locals`, async () => {
      const text = 'int VALUE = 1;\nvoid Previous() { string hidden; }\nvoid main() {\n { string VALUE = "local"; }\n int result = VALUE;\n}'.split("VALUE").join(name);
      const uri = params().textDocument.uri;
      writeFileSync(join(workspace, "sample.nss"), text);
      const client = await start({ initializationOptions: { compiler: { enabled: false }, completion: { autoImport: false } } });
      await client.ready();
      await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
      const request = { textDocument: { uri }, position: { line: 4, character: 19 } };
      const items: any = await client.rpc.sendRequest(CompletionRequest.type, request);
      expect(items.some((item: any) => item.label === "hidden")).to.equal(false);
      expect(items.find((item: any) => item.label === name)?.detail).to.equal("(constant) 1: int");
      expect(content(await client.rpc.sendRequest(HoverRequest.type, request))?.value).to.equal(`int ${name} = 1`);
      const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, request);
      expect(definition.range.start).to.deep.equal({ line: 0, character: 4 });
      await client.shutdown();
    });
  }

  for (const signature of [
    "int Fn(int value);",
    "int Fn(\n    int value\n);",
    "int Fn(int\n value);",
    "int Fn(int /*type*/ value);",
    "int Fn(int\n value) { return value; }",
    "int\n Fn(int value);",
  ]) {
    it(`keeps prototype parameters scoped to their signature: ${JSON.stringify(signature)}`, async () => {
      const text = `string value;\n${signature}\nvoid main() { string copy = value; }\n`;
      const uri = params().textDocument.uri;
      writeFileSync(join(workspace, "sample.nss"), text);
      const client = await start();
      await client.ready();
      await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
      const document = TextDocument.create(uri, "nwscript", 1, text);
      const parameterOffset = text.indexOf("value", text.indexOf("Fn"));
      const parameter = { textDocument: { uri }, position: document.positionAt(parameterOffset + 2) };
      expect(content(await client.rpc.sendRequest(HoverRequest.type, parameter))?.value).to.equal("int value");
      const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, parameter);
      expect(definition.range.start).to.deep.equal(document.positionAt(parameterOffset));
      const outside = { textDocument: { uri }, position: document.positionAt(text.lastIndexOf("value") + 2) };
      expect(content(await client.rpc.sendRequest(HoverRequest.type, outside))?.value).to.include("string value");
      const globalDefinition: any = await client.rpc.sendRequest(DefinitionRequest.type, outside);
      expect(globalDefinition.range.start).to.deep.equal({ line: 0, character: 7 });
      await client.shutdown();
    });
  }

  for (const declaration of ["struct Data {\n int field;\n};", "struct Data { int field; };", "struct Data { int first, field; };"]) {
    it(`resolves struct field declaration sites without selecting a same-named global: ${JSON.stringify(declaration)}`, async () => {
      const text = `string field;\n${declaration}\nstruct Other { float field; };\nvoid main() { string copy = field; }\n`;
      const uri = params().textDocument.uri;
      writeFileSync(join(workspace, "sample.nss"), text);
      const client = await start();
      await client.ready();
      await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
      const document = TextDocument.create(uri, "nwscript", 1, text);
      const fields = [
        [text.indexOf("field", text.indexOf("Data")), "int field"],
        [text.indexOf("field", text.indexOf("Other")), "float field"],
      ] as const;
      for (const [offset, hover] of fields) {
        const target = { textDocument: { uri }, position: document.positionAt(offset + 2) };
        expect(content(await client.rpc.sendRequest(HoverRequest.type, target))?.value).to.equal(hover);
        const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, target);
        expect(definition.uri).to.equal(uri);
        expect(definition.range.start).to.deep.equal(document.positionAt(offset));
      }
      const global = { textDocument: { uri }, position: document.positionAt(text.lastIndexOf("field") + 2) };
      expect(content(await client.rpc.sendRequest(HoverRequest.type, global))?.value).to.include("string field");
      const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, global);
      expect(definition.range.start).to.deep.equal({ line: 0, character: 7 });
      await client.shutdown();
    });
  }

  for (const rootName of ["global", "local"]) {
    it(`resolves nested members of a ${rootName} struct across providers`, async () => {
      writeFileSync(join(workspace, "helper.nss"), "struct Inner { int field; };\nstruct Outer { struct Inner child; };\n");
      const text = `#include "helper"\nstruct Outer global;\nvoid main() {\n struct Outer local;\n ${rootName}.child.field = 1;\n}\n`;
      const uri = params().textDocument.uri;
      writeFileSync(join(workspace, "sample.nss"), text);
      const client = await start();
      await client.ready();
      await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
      const dot = { textDocument: { uri }, position: { line: 4, character: rootName.length + 8 }, context: { triggerKind: 2 as const, triggerCharacter: "." } };
      const fields: any = await client.rpc.sendRequest(CompletionRequest.type, dot);
      expect(fields.map((item: any) => item.label)).to.deep.equal(["field"]);
      const member = { textDocument: { uri }, position: { line: 4, character: rootName.length + 10 } };
      const manual: any = await client.rpc.sendRequest(CompletionRequest.type, member);
      expect(manual.map((item: any) => item.label)).to.deep.equal(["field"]);
      expect(content(await client.rpc.sendRequest(HoverRequest.type, member))?.value).to.equal("int field");
      const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, member);
      expect(definition.uri).to.equal(pathToFileURL(join(workspace, "helper.nss")).href);
      expect(definition.range.start).to.deep.equal({ line: 0, character: 19 });
      await client.shutdown();
    });
  }

  for (const access of ["global", "local", "nested.field"]) {
    it(`resolves built-in vector fields through ${access}`, async () => {
      const text = `struct Container { vector field; };\nvector global;\nstruct Container nested;\nvoid main() {\n vector local;\n ${access}.x = 1.0;\n}\n`;
      const uri = params().textDocument.uri;
      writeFileSync(join(workspace, "sample.nss"), text);
      const client = await start();
      await client.ready();
      await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
      const member = { textDocument: { uri }, position: { line: 5, character: access.length + 3 } };
      const fields: any = await client.rpc.sendRequest(CompletionRequest.type, member);
      expect(fields.map((item: any) => item.label)).to.deep.equal(["x", "y", "z"]);
      expect(content(await client.rpc.sendRequest(HoverRequest.type, member))?.value).to.equal("float x");
      expect(await client.rpc.sendRequest(DefinitionRequest.type, member)).to.equal(null);
      await client.shutdown();
    });
  }

  for (const scope of ["global", "local"]) {
    it(`does not resolve a parenthesized member as an unrelated ${scope} variable`, async () => {
      const declaration = 'string x = "unrelated";';
      const text = `${scope === "global" ? declaration : ""}\nvoid main() {\n ${scope === "local" ? declaration : ""}\n vector v;\n float result = (v).x;\n string copy = x;\n}\n`;
      const uri = params().textDocument.uri;
      writeFileSync(join(workspace, "sample.nss"), text);
      const client = await start();
      await client.ready();
      await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
      const member = { textDocument: { uri }, position: { line: 4, character: 21 } };
      for (const character of [20, 21]) {
        const completion = { textDocument: { uri }, position: { line: 4, character } };
        expect(await client.rpc.sendRequest(CompletionRequest.type, completion)).to.deep.equal([]);
      }
      expect(await client.rpc.sendRequest(HoverRequest.type, member)).to.equal(null);
      expect(await client.rpc.sendRequest(DefinitionRequest.type, member)).to.equal(null);
      await client.rpc.sendNotification("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: text.replace("(v).x", "(v). x") }] });
      for (const character of [20, 21, 22]) {
        expect(await client.rpc.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line: 4, character } })).to.deep.equal([]);
      }
      const variable = { textDocument: { uri }, position: { line: 5, character: 16 } };
      expect(content(await client.rpc.sendRequest(HoverRequest.type, variable))?.value).to.include("string x");
      const definition: any = await client.rpc.sendRequest(DefinitionRequest.type, variable);
      expect(definition.range.start.line).to.equal(scope === "global" ? 0 : 2);
      await client.shutdown();
    });
  }

  it("does not restore removed workspace symbols when their open document closes", async () => {
    const added = mkdtempSync(join(temporary, "remaining "));
    const uri = pathToFileURL(join(added, "current.nss")).href;
    const text = "void main() {\n Helper\n}\n";
    writeFileSync(join(added, "current.nss"), text);
    const client = await start({ capabilities: { workspace: { workspaceFolders: true } } });
    await client.ready();
    const helperUri = pathToFileURL(join(workspace, "helper.nss")).href;
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: helperUri, languageId: "nwscript", version: 1, text: helper } });
    await client.rpc.sendNotification("workspace/didChangeWorkspaceFolders", {
      event: {
        removed: [{ uri: pathToFileURL(workspace).href, name: "removed" }],
        added: [{ uri: pathToFileURL(added).href, name: "remaining" }],
      },
    });
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
    const complete = async () => {
      const result: any = await client.rpc.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line: 1, character: 7 } });
      return (result.items || result).map((item: any) => item.label);
    };
    expect(await complete()).not.to.include("Helper");
    await client.rpc.sendNotification("textDocument/didClose", { textDocument: { uri: helperUri } });
    expect(await complete()).not.to.include("Helper");
    await client.shutdown();
  });

  it("discards late index results from removed workspace folders", async () => {
    const indexer = join(packageRoot, "server/out/indexer.js");
    const original = readFileSync(indexer);
    const release = join(temporary, "release-indexer");
    const added = mkdtempSync(join(temporary, "added "));
    const uri = pathToFileURL(join(added, "current.nss")).href;
    const text = "void main() {\n Ghost\n}\n";
    writeFileSync(join(added, "current.nss"), text);
    try {
      writeFileSync(
        indexer,
        `
        process.once("message", paths => {
          const timer = setInterval(() => {
            if (!require("fs").existsSync(${JSON.stringify(release)})) return;
            clearInterval(timer);
            for (const filePath of paths) process.send({ filePath, documentTokens: {
              children: [], structDeclarations: [], globalDeclarations: [{
                identifier: "GhostFromRemovedFolder", tokenType: 3, returnType: "void",
                params: [], comments: [], position: { line: 0, character: 5 }
              }]
            }});
            process.disconnect();
          }, 20);
        });
      `,
      );
      const client = await start({ capabilities: { workspace: { workspaceFolders: true } } });
      await client.waitFor(() => client.logs.includes("Indexing files ..."));
      await client.rpc.sendNotification("workspace/didChangeWorkspaceFolders", {
        event: {
          removed: [{ uri: pathToFileURL(workspace).href, name: "old" }],
          added: [{ uri: pathToFileURL(added).href, name: "new" }],
        },
      });
      await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text } });
      // A request after the notifications ensures the folder change has been handled.
      await client.rpc.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line: 1, character: 6 } });
      writeFileSync(release, "");
      await client.ready();
      const result = await client.rpc.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line: 1, character: 6 } });
      expect(JSON.stringify(result)).not.to.include("GhostFromRemovedFolder");
      await client.shutdown();
    } finally {
      writeFileSync(indexer, original);
      rmSync(release, { force: true });
    }
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
      for (const [index, suffix] of ["void Unfinished(", "void Unfinished(\n int value,\n", "void Unfinished();", "struct Unfinished {\n int ", "struct Unfinished {\n int field;\n};"].entries()) {
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

  it("keeps running when a formatter exits before consuming a large document", async () => {
    // Node rejects clang-format's arguments before consuming stdin on all platforms.
    const client = await start({ initializationOptions: { compiler: { enabled: false }, formatter: { executable: process.execPath } } });
    await client.ready();
    await open(client);
    const uri = pathToFileURL(join(workspace, "large.nss")).href;
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "nwscript", version: 1, text: `/*${"x".repeat(1024 * 1024)}*/\nvoid main() {}` } });
    const result = await client.rpc.sendRequest(DocumentFormattingRequest.type, { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } });
    expect(result).to.equal(null);
    await features(client);
    await client.shutdown();
  });

  for (const encoded of [false, true]) {
    it(`refreshes external changes, deletion, and creation with encoded URI=${String(encoded)}`, async () => {
      const client = await start();
      await client.ready();
      await open(client);
      const canonicalUri = pathToFileURL(join(workspace, "helper.nss")).href;
      const helperUri = encoded ? canonicalUri.replace("helper.nss", "%68elper.nss").replace(/\/([A-Za-z]):/, "/$1%3A") : canonicalUri;
      const completion = async () => JSON.stringify(await client.rpc.sendRequest(CompletionRequest.type, params()));
      expect(await completion()).to.include('"label":"Helper"');
      writeFileSync(join(workspace, "helper.nss"), "void Updated() {}\n");
      await client.rpc.sendNotification("workspace/didChangeWatchedFiles", { changes: [{ uri: helperUri, type: 2 }] });
      expect(await completion())
        .to.include('"label":"Updated"')
        .and.not.include('"label":"Helper"');
      rmSync(join(workspace, "helper.nss"));
      await client.rpc.sendNotification("workspace/didChangeWatchedFiles", { changes: [{ uri: helperUri, type: 3 }] });
      expect(await completion()).not.to.include('"label":"Updated"');
      writeFileSync(join(workspace, "helper.nss"), "void Created() {}\n");
      await client.rpc.sendNotification("workspace/didChangeWatchedFiles", { changes: [{ uri: helperUri, type: 1 }] });
      expect(await completion()).to.include('"label":"Created"');
      await client.shutdown();
    });
  }

  it("preserves the live document when a watcher uses an equivalent URI", async () => {
    const client = await start();
    await client.ready();
    await open(client);
    const canonical = pathToFileURL(join(workspace, "helper.nss")).href;
    const alternate = canonical.replace("helper.nss", "%68elper.nss").replace(/\/([A-Za-z]):/, "/$1%3A");
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: alternate, languageId: "nwscript", version: 1, text: "void Unsaved() {}" } });
    await client.rpc.sendNotification("workspace/didChangeWatchedFiles", { changes: [{ uri: canonical, type: 2 }] });
    const completion = async () => JSON.stringify(await client.rpc.sendRequest(CompletionRequest.type, params()));
    expect(await completion())
      .to.include('"label":"Unsaved"')
      .and.not.include('"label":"Helper"');
    await client.rpc.sendNotification("textDocument/didClose", { textDocument: { uri: alternate } });
    expect(await completion())
      .to.include('"label":"Helper"')
      .and.not.include('"label":"Unsaved"');
    await client.shutdown();
  });

  it("resolves case-insensitive includes, uppercase extensions, and prototype-like filenames", async () => {
    writeFileSync(join(workspace, "UPPER.NSS"), "void UpperFunction() {}\n");
    writeFileSync(join(workspace, "constructor.nss"), "void ConstructorFunction() {}\n");
    const client = await start();
    await client.ready();
    const text = '#include "HELPER"\n#include "UPPER"\n#include "CONSTRUCTOR"\nvoid main() {\n \n}\n';
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { ...params().textDocument, languageId: "nwscript", version: 1, text } });
    const response = await client.rpc.sendRequest(CompletionRequest.type, { ...params(), position: { line: 4, character: 1 } });
    const items = Array.isArray(response) ? response : response?.items || [];
    for (const label of ["Helper", "UpperFunction", "ConstructorFunction"]) {
      expect(items.find((item) => item.label === label)?.label).to.equal(label);
      expect(items.find((item) => item.label === label)).not.to.have.property("additionalTextEdits");
    }
    await client.shutdown();
  });

  it("indexes added workspace folders and removes their imports when detached", async () => {
    const added = join(temporary, "added-workspace");
    mkdirSync(added, { recursive: true });
    const folder = { name: "added", uri: pathToFileURL(added).href };
    writeFileSync(join(added, "fresh.nss"), "void HelperFromFolder() {}\n");
    const client = await start({ capabilities: { workspace: { workspaceFolders: true } } });
    await client.ready();
    await open(client);
    await client.rpc.sendNotification("workspace/didChangeWorkspaceFolders", { event: { added: [folder], removed: [] } });
    const request = async () => JSON.stringify(await client.rpc.sendRequest(CompletionRequest.type, params()));
    expect(await request())
      .to.include("HelperFromFolder")
      .and.include('"label":"Helper"');
    await client.rpc.sendNotification("workspace/didChangeWorkspaceFolders", { event: { added: [], removed: [folder] } });
    expect(await request()).not.to.include("HelperFromFolder");
    await client.shutdown();
  });

  it("uses live global values and locations consistently across editor providers", async () => {
    const client = await start();
    await client.ready();
    const saved = "const int LIVE_VALUE = 1;\nvoid main() {\n LIVE_VALUE;\n}\n";
    await client.rpc.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { ...params().textDocument, languageId: "nwscript", version: 1, text: saved } });
    const changed = "\n" + saved.replace("= 1", "= 2");
    await client.rpc.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { ...params().textDocument, version: 2 }, contentChanges: [{ text: changed }] });
    const target = { ...params(), position: { line: 3, character: 6 } };
    expect(JSON.stringify(await client.rpc.sendRequest(CompletionRequest.type, target))).to.include("(constant) 2: int");
    expect(content(await client.rpc.sendRequest(HoverRequest.type, target))?.value).to.include("LIVE_VALUE = 2");
    expect(await client.rpc.sendRequest(DefinitionRequest.type, target)).to.deep.equal({
      uri: params().textDocument.uri,
      range: { start: { line: 1, character: 10 }, end: { line: 1, character: 10 } },
    });
    const symbols = await client.rpc.sendRequest(DocumentSymbolRequest.type, { textDocument: params().textDocument });
    expect(JSON.stringify(symbols)).to.include('"line":1');
    await client.shutdown();
  });

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
