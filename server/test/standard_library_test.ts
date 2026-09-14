import { before, beforeEach, afterEach, describe, it } from "mocha";
import { expect } from "chai";
import { buildSync } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";

// Bundle like production so resource/grammar paths are exercised too.
describe("Workspace standard library", function () {
  this.timeout(10000);
  let api: any;
  let root: string;
  let files: any;
  let library: any;
  let tokenizer: any;
  let errors: string[];
  const uri = (path: string) => pathToFileURL(path).href;
  const source = "// Custom API\nint CustomFn(string value, int count = 7);\nconst int CUSTOM_VALUE = 42;\n";
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };

  before(async () => {
    const bundle = join(__dirname, "../out/standard-library-test.js");
    buildSync({
      stdin: {
        contents: `export { default as StandardLibrary } from './Documents/StandardLibrary';
          export { default as Files } from './WorkspaceFilesSystem/WorkspaceFilesSystem';
          export { default as Collection } from './Documents/DocumentsCollection';
          export { Tokenizer } from './Tokenizer';
          export { default as Completion } from './Providers/CompletionItemsProvider';
          export { default as Hover } from './Providers/HoverContentProvider';
          export { default as Signature } from './Providers/SignatureHelpProvider';
          export { default as Definition } from './Providers/GotoDefinitionProvider';
          export { default as Workspace } from './Providers/WorkspaceProvider';
          export { default as Manager } from './ServerManager/ServerManager';
          export { defaultServerConfiguration as config } from './ServerManager/Config';`,
        resolveDir: join(__dirname, "../src"),
        loader: "ts",
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
    });
    api = require(bundle);
    tokenizer = await new api.Tokenizer().loadGrammar();
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nwscript workspace & spaces "));
    files = new api.Files(root, null);
    errors = [];
    library = new api.StandardLibrary(files, tokenizer, (message: string) => errors.push(message));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  for (const include of ["", '#include "nwscript"\n']) {
    it(`replaces the bundle ${include ? "with" : "without"} an explicit include across editor features`, () => {
      const spec = join(root, "nwscript.nss");
      write(spec, source);
      const script = TextDocument.create(uri(join(root, "test.nss")), "nwscript", 1, include + 'void main()\n{\n    CustomFn("x", 2);\n}\n');
      const collection = new api.Collection();
      collection.createDocuments(script.uri, script.getText(), tokenizer, files);
      const handlers: any = {};
      const server = {
        capabilitiesHandler: { getSupportsMarkdownHover: () => true },
        standardLibrary: library,
        documentsCollection: collection,
        tokenizer,
        config: { ...api.config, hovering: { addCommentsToFunctions: true } },
        liveDocumentsManager: { get: () => script },
        logger: { error: (message: string) => errors.push(message) },
        connection: {
          onCompletion: (fn: any) => (handlers.completion = fn),
          onCompletionResolve: () => {},
          onHover: (fn: any) => (handlers.hover = fn),
          onSignatureHelp: (fn: any) => (handlers.signature = fn),
          onDefinition: (fn: any) => (handlers.definition = fn),
        },
      };
      api.Completion.register(server);
      api.Hover.register(server);
      api.Signature.register(server);
      api.Definition.register(server);
      const params = { textDocument: { uri: script.uri }, position: { line: include ? 3 : 2, character: 8 } };
      const items = handlers.completion(params);
      expect(items.filter((item: any) => item.label === "CustomFn")).to.have.length(1);
      expect(items.some((item: any) => item.label === "GetObjectByTag")).to.equal(false);
      expect(items.find((item: any) => item.label === "CUSTOM_VALUE").detail).to.include("42");
      expect(handlers.hover(params).contents.value).to.include("int CustomFn(string value, int count = 7)").and.include("Custom API");
      expect(handlers.signature({ ...params, position: { line: include ? 3 : 2, character: 18 } }).signatures[0].label).to.equal("int CustomFn(string value, int count)");
      expect(handlers.definition(params)).to.deep.equal({ uri: uri(spec), range: { start: { line: 1, character: 4 }, end: { line: 1, character: 4 } } });
      expect(errors).to.deep.equal([]);
    });
  }

  function editorServer() {
    const handlers: any = {};
    const documents = new Map<string, TextDocument>();
    const server = Object.assign(Object.create(api.Manager.prototype), {
      capabilitiesHandler: { getSupportsMarkdownHover: () => true },
      standardLibrary: library,
      documentsCollection: new api.Collection(),
      tokenizer,
      workspaceFilesSystem: files,
      config: api.config,
      logger: { error: (message: string) => errors.push(message) },
      liveDocumentsManager: {
        get: (target: string) => documents.get(target),
        onDidOpen: (fn: any) => (handlers.open = fn),
        onDidChangeContent: (fn: any) => (handlers.change = fn),
        onDidClose: () => {},
        onDidSave: () => {},
        onWillSave: () => {},
      },
      connection: {
        onCompletion: (fn: any) => (handlers.completion = fn),
        onCompletionResolve: () => {},
        onHover: (fn: any) => (handlers.hover = fn),
        onSignatureHelp: (fn: any) => (handlers.signature = fn),
        onDefinition: (fn: any) => (handlers.definition = fn),
      },
    });
    server.registerLiveDocumentsEvents();
    api.Completion.register(server);
    api.Hover.register(server);
    api.Signature.register(server);
    api.Definition.register(server);
    const open = (document: TextDocument) => {
      documents.set(document.uri, document);
      handlers.open({ document });
    };
    return { server, handlers, open, documents };
  }

  it("uses the requesting URI for hover and definition with duplicate script basenames across workspaces", () => {
    const a = join(root, "a");
    const b = join(root, "b");
    write(join(a, "nwscript.nss"), "int CustomFn(int n);\n");
    write(join(b, "nwscript.nss"), "float CustomFn(string text);\n");
    files.setWorkspaceFolders([
      { name: "a", uri: uri(a) },
      { name: "b", uri: uri(b) },
    ]);
    const editor = editorServer();
    const content = 'void main()\n{\n    CustomFn("x");\n}\n';
    const first = TextDocument.create(uri(join(a, "test.nss")), "nwscript", 1, content);
    const second = TextDocument.create(uri(join(b, "test.nss")), "nwscript", 1, content);
    editor.open(first);
    editor.open(second);
    expect(editor.server.documentsCollection.getFromUri(first.uri).uri).to.equal(first.uri);
    expect(editor.server.documentsCollection.getFromUri(second.uri).uri).to.equal(second.uri);
    // Protect provider selection even if a basename-based reference belongs to
    // another document, independently of the collection's exact-URI lookup.
    const wrongDocument = editor.server.documentsCollection.getFromUri(first.uri);
    editor.server.documentsCollection.getFromUri = () => wrongDocument;
    const params = { textDocument: { uri: second.uri }, position: { line: 2, character: 8 } };
    expect(editor.handlers.hover(params).contents.value).to.include("float CustomFn(string text)");
    expect(editor.handlers.definition(params).uri).to.equal(uri(join(b, "nwscript.nss")));
    expect(errors).to.deep.equal([]);
  });

  it("registers selected, unselected, and outside-workspace specifications independently across editor features", () => {
    const workspace = join(root, "workspace");
    files.setWorkspaceFolders([{ name: "workspace", uri: uri(workspace) }]);
    const paths = [join(workspace, "nwscript.nss"), join(workspace, "sub", "nwscript.nss"), join(root, "outside", "nwscript.nss")];
    const editor = editorServer();
    const opened = paths.map((path, index) => {
      const content = `// Header ${index}\nint OwnFn${index}(int n);\nvoid main()\n{\n    OwnFn${index}(1);\n}\n`;
      write(path, content);
      const document = TextDocument.create(uri(path), "nwscript", 1, content);
      editor.open(document);
      return document;
    });
    opened.forEach((document, index) => {
      expect(editor.server.documentsCollection.getFromUri(document.uri).uri).to.equal(document.uri);
      const params = { textDocument: { uri: document.uri }, position: { line: 4, character: 8 } };
      expect(editor.handlers.completion(params).some((item: any) => item.label === `OwnFn${index}`)).to.equal(true);
      expect(editor.handlers.hover(params).contents.value).to.include(`int OwnFn${index}(int n)`);
      expect(editor.handlers.signature({ ...params, position: { line: 4, character: 11 } }).signatures[0].label).to.equal(`int OwnFn${index}(int n)`);
      expect(editor.handlers.definition(params).uri).to.equal(document.uri);
    });
    expect(library.get(uri(join(workspace, "test.nss"))).owner).to.equal(uri(paths[0]));
    const changed = TextDocument.create(opened[1].uri, "nwscript", 2, "float EditedFn();\n");
    editor.handlers.change({ document: changed });
    expect(editor.server.documentsCollection.getFromUri(changed.uri).complexTokens[0].identifier).to.equal("EditedFn");
    expect(editor.server.documentsCollection.getFromUri(opened[0].uri).complexTokens[0].identifier).to.equal("OwnFn0");
    expect(errors).to.deep.equal([]);
  });

  it("registers an initially incomplete unselected specification and recovers after editing", () => {
    write(join(root, "nwscript.nss"), source);
    const path = join(root, "sub", "nwscript.nss");
    write(path, "int Broken(");
    const editor = editorServer();
    const document = TextDocument.create(uri(path), "nwscript", 1, "int Broken(");
    expect(() => editor.open(document)).not.to.throw();
    expect(editor.server.documentsCollection.getFromUri(document.uri).uri).to.equal(document.uri);
    editor.handlers.change({ document: TextDocument.create(document.uri, "nwscript", 2, "int Recovered();\n") });
    expect(editor.server.documentsCollection.getFromUri(document.uri).complexTokens[0].identifier).to.equal("Recovered");
    expect(library.get(document.uri).owner).to.equal(uri(join(root, "nwscript.nss")));
  });

  it("refreshes unsaved changes, retains usable definitions for incomplete edits, and restores disk on close", () => {
    const spec = join(root, "nwscript.nss");
    write(spec, source);
    const target = uri(join(root, "test.nss"));
    const initial = library.get(target);
    library.change(TextDocument.create(uri(spec), "nwscript", 1, "// Edited\nfloat ChangedFn();\n"));
    expect(library.get(target).complexTokens.map((token: any) => token.identifier)).to.deep.equal(["ChangedFn"]);
    library.change(TextDocument.create(uri(spec), "nwscript", 2, "int Broken("));
    expect(library.get(target).complexTokens[0].identifier).to.equal("ChangedFn");
    library.get(target);
    expect(errors).to.have.length(1);
    library.close(uri(spec));
    expect(library.get(target)).to.deep.equal(initial);
  });

  for (const [changeEncoded, closeEncoded] of [
    [true, false],
    [false, true],
    [true, true],
  ]) {
    it(`normalizes URI encoding for ${changeEncoded ? "encoded" : "literal"} changes and ${closeEncoded ? "encoded" : "literal"} cleanup`, () => {
      // On Windows the drive separator supplies the colon; elsewhere use a
      // legal colon-containing directory so the same test runs on every OS.
      const directory = process.platform === "win32" ? root : join(root, "api:custom");
      const spec = join(directory, "nwscript.nss");
      write(spec, "int SavedFn();\n");
      const canonical = uri(spec);
      const encoded = canonical.slice(0, 7) + canonical.slice(7).replace(/:/g, "%3A");
      expect(encoded).not.to.equal(canonical);
      expect(library.get(encoded).complexTokens[0].identifier).to.equal("SavedFn");
      const changeUri = changeEncoded ? encoded : canonical;
      library.change(TextDocument.create(changeUri, "nwscript", 1, "int UnsavedFn();\n"));
      for (const requestUri of [canonical, encoded]) {
        expect(library.get(requestUri).complexTokens[0].identifier).to.equal("UnsavedFn");
      }
      library.change(TextDocument.create(changeUri, "nwscript", 2, "int Broken("));
      expect(library.get(encoded).complexTokens[0].identifier).to.equal("UnsavedFn");
      expect(errors).to.have.length(1);
      library.close(closeEncoded ? encoded : canonical);
      expect(library.get(canonical).complexTokens[0].identifier).to.equal("SavedFn");
      // Closing must clear failed-content and diagnostic caches too, so the
      // same incomplete text in a new editing session is handled afresh.
      library.change(TextDocument.create(changeUri, "nwscript", 3, "int Broken("));
      expect(library.get(encoded).complexTokens[0].identifier).to.equal("SavedFn");
      expect(errors).to.have.length(2);
    });
  }

  it("handles creation, external changes, deletion, and an invalid initial file", () => {
    const spec = join(root, "nwscript.nss");
    const target = uri(join(root, "test.nss"));
    expect(library.get(target).owner).to.equal(undefined);
    write(spec, "");
    library.invalidate();
    expect(library.get(target).owner).to.equal(undefined);
    expect(errors).to.have.length(1);
    write(spec, source);
    library.invalidate();
    expect(library.get(target).owner).to.equal(uri(spec));
    write(spec, "int ExternalFn();\n");
    library.invalidate();
    expect(library.get(target).complexTokens[0].identifier).to.equal("ExternalFn");
    rmSync(spec);
    library.invalidate();
    expect(library.get(target).owner).to.equal(undefined);
  });

  it("selects the shallowest then lexical file, ignores lookalike filenames, and uses the same path for diagnostics", () => {
    write(join(root, "not_nwscript.nss"), source);
    write(join(root, "a", "deep", "nwscript.nss"), source);
    write(join(root, "z", "nwscript.nss"), source);
    const target = uri(join(root, "test.nss"));
    expect(library.getPath(target)).to.equal(join(root, "z", "nwscript.nss"));
    write(join(root, "a", "NWSCRIPT.NSS"), source);
    library.invalidate();
    expect(library.get(target).owner).to.equal(uri(library.getPath(target)));
    expect(library.getPath(target)).to.equal(join(root, "a", "NWSCRIPT.NSS"));
    write(join(root, "nwscript.nss"), source);
    library.invalidate();
    expect(library.getPath(target)).to.equal(join(root, "nwscript.nss"));
  });

  it("isolates workspace folders, including nested roots, and falls back when a folder is removed", () => {
    const nested = join(root, "nested");
    write(join(nested, "nwscript.nss"), source);
    files.setWorkspaceFolders([
      { name: "parent", uri: uri(root) },
      { name: "nested", uri: uri(nested) },
    ]);
    expect(library.get(uri(join(root, "test.nss"))).owner).to.equal(undefined);
    expect(library.get(uri(join(nested, "test.nss"))).owner).to.equal(uri(join(nested, "nwscript.nss")));
    files.setWorkspaceFolders([]);
    library.invalidate();
    expect(library.get(uri(join(nested, "test.nss"))).owner).to.equal(undefined);
  });

  it("retains the last usable snapshot when the selected file cannot be read", () => {
    const spec = join(root, "nwscript.nss");
    const target = uri(join(root, "test.nss"));
    write(spec, source);
    const snapshot = library.get(target);
    // Simulate a discovery/read race without depending on OS permission rules.
    files.getStandardLibraryPath = () => spec;
    rmSync(spec);
    library.invalidate();
    expect(library.get(target)).to.equal(snapshot);
    expect(errors).to.have.length(1);
    library.get(target);
    expect(errors).to.have.length(1);
  });

  it("falls back if workspace discovery fails and retries after invalidation", () => {
    const select = files.getStandardLibraryPath.bind(files);
    files.getStandardLibraryPath = () => {
      throw new Error("Unreadable directory");
    };
    const target = uri(join(root, "test.nss"));
    expect(library.get(target).owner).to.equal(undefined);
    expect(errors[0]).to.include("Unreadable directory");
    files.getStandardLibraryPath = select;
    write(join(root, "nwscript.nss"), source);
    library.invalidate();
    expect(library.get(target).owner).to.equal(uri(join(root, "nwscript.nss")));
  });

  it("refreshes on watched-file and workspace events, clearing a deleted source snapshot", () => {
    const spec = join(root, "nwscript.nss");
    const target = uri(join(root, "test.nss"));
    write(spec, source);
    library.get(target);
    let watched: any;
    let folders: any;
    let refreshes = 0;
    api.Workspace.register({
      capabilitiesHandler: { getSupportsWorkspaceFolders: () => true },
      workspaceFilesSystem: files,
      standardLibrary: library,
      refreshStandardLibrary: () => {
        refreshes++;
        library.invalidate();
      },
      connection: {
        workspace: { onDidChangeWorkspaceFolders: (fn: any) => (folders = fn) },
        onDidChangeWatchedFiles: (fn: any) => (watched = fn),
      },
    });
    rmSync(spec);
    watched({ changes: [{ uri: uri(spec), type: 3 }] });
    expect(library.get(target).owner).to.equal(undefined);
    write(spec, "");
    watched({ changes: [{ uri: uri(spec), type: 1 }] });
    expect(library.get(target).owner).to.equal(undefined);
    folders({ added: [{ name: "root", uri: uri(root) }], removed: [] });
    expect(refreshes).to.equal(3);
  });

  it("caches tokenization until source content changes", () => {
    write(join(root, "nwscript.nss"), source);
    const target = uri(join(root, "test.nss"));
    const snapshot = library.get(target);
    expect(library.get(target)).to.equal(snapshot);
    library.invalidate();
    expect(library.get(target)).to.equal(snapshot);
  });
});
