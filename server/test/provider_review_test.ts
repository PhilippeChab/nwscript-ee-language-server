import { before, beforeEach, afterEach, describe, it } from "mocha";
import { expect } from "chai";
import { buildServerBundle } from "../scripts/Build";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind, SymbolKind } from "vscode-languageserver";

describe("Provider cross-feature review", () => {
  let api: any;
  let parser: any;
  let root: string;
  before(async () => {
    const bundle = join(__dirname, "../out/provider-review-test.js");
    buildServerBundle({
      stdin: {
        contents: `export { default as Parser } from './Language/Parser';
      export { default as Collection } from './Documents/DocumentsCollection';
      export { default as Hover } from './Providers/HoverContentProvider';
      export { default as Definition } from './Providers/GotoDefinitionProvider';
      export { default as Completion } from './Providers/CompletionItemsProvider';
      export { default as Symbols } from './Providers/SymbolsProvider';
      export { default as Signature } from './Providers/SignatureHelpProvider';
      export { defaultServerConfiguration as config } from './ServerManager/Config';`,
        resolveDir: join(__dirname, "../src"),
        loader: "ts",
      },
      outfile: bundle,
    });
    api = require(bundle);
    parser = await new api.Parser().loadGrammar();
  });
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nw-provider-review-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function editor(markdown = false, hierarchical = false) {
    const live = new Map<string, TextDocument>();
    const collection = new api.Collection();
    const handlers: any = {};
    const server = {
      parser,
      documentsCollection: collection,
      liveDocumentsManager: { get: (uri: string) => live.get(uri) },
      standardLibrary: { get: () => ({ globalDeclarations: [], structDeclarations: [] }) },
      config: { ...api.config, completion: { ...api.config.completion, autoImport: false }, hovering: { addCommentsToFunctions: true } },
      capabilitiesHandler: { getSupportsMarkdownHover: () => markdown, getSupportsHierarchicalSymbols: () => hierarchical },
      logger: {
        error: (message: string) => {
          throw new Error(message);
        },
      },
      connection: {
        onHover: (fn: any) => (handlers.hover = fn),
        onDefinition: (fn: any) => (handlers.definition = fn),
        onCompletion: (fn: any) => (handlers.completion = fn),
        onCompletionResolve: (fn: any) => (handlers.resolve = fn),
        onDocumentSymbol: (fn: any) => (handlers.symbols = fn),
        onSignatureHelp: (fn: any) => (handlers.signature = fn),
      },
    };
    for (const provider of [api.Hover, api.Definition, api.Completion, api.Symbols, api.Signature]) provider.register(server);
    const add = (name: string, source: string, open = true) => {
      const path = join(root, name);
      writeFileSync(path, source);
      const document = TextDocument.create(pathToFileURL(path).href, "nwscript", 1, source);
      collection.addDocument(document.uri, parser.indexContent(source));
      if (open) live.set(document.uri, document);
      return document;
    };
    return { handlers, add, live };
  }
  const request = (document: TextDocument, offset: number) => ({ textDocument: { uri: document.uri }, position: document.positionAt(offset) });

  it("keeps all providers on the current syntax after unsaved edits and incomplete declarations", () => {
    const { handlers, add } = editor(false, true);
    const document = add("live.nss", "int Value;\nint Fn(int arg);\nvoid main() { Fn(Value); }");
    const initial = request(document, document.getText().lastIndexOf("Value") + 2);
    expect(handlers.hover(initial).contents.value).to.include("int Value");
    expect(handlers.completion(initial).find((item: any) => item.label === "Value").detail).to.include("Value: int");

    const source = "\nstring Value;\nstring Fn(string arg) { return arg; }\nvoid main() { Fn(Value); }\nstruct Unfinished { int ";
    TextDocument.update(document, [{ text: source }], 2);
    const params = request(document, source.lastIndexOf("Value") + 2);
    expect(handlers.hover(params).contents.value).to.include("string Value");
    expect(handlers.completion(params).find((item: any) => item.label === "Value").detail).to.include("Value: string");
    expect(handlers.signature(params).signatures[0].label).to.equal("string Fn(string arg)");
    expect(handlers.definition(params).range.start).to.deep.equal(document.positionAt(source.indexOf("Value")));
    expect(handlers.symbols(params).find((symbol: any) => symbol.name === "Value").selectionRange.start).to.deep.equal(document.positionAt(source.indexOf("Value")));
    expect(handlers.definition(request(document, source.lastIndexOf("Fn(") + 1)).range.start).to.deep.equal(document.positionAt(source.indexOf("Fn(")));

    const quoted = 'void main() { string text = r"Value"; }';
    TextDocument.update(document, [{ text: quoted }], 3);
    expect(handlers.completion(request(document, quoted.indexOf("Value") + 2))).to.deep.equal([]);
  });

  for (const [type, value] of [
    ["int", "0"],
    ["float", "0.0"],
    ["string", '""'],
    ["vector", "[0.0, 0.0, 0.0]"],
  ]) {
    for (const markdown of [false, true]) {
      for (const eol of ["\n", "\r\n"]) {
        it(`renders ${type} zero/empty values across providers (markdown=${String(markdown)}, eol=${JSON.stringify(eol)})`, () => {
          const { handlers, add } = editor(markdown, markdown);
          const source = [`${type} Global = ${value};`, `const ${type} Fixed = ${value};`, `void Fn(${type} parameter = ${value});`, "void main() { Fn(Global); }"].join(eol);
          const document = add("details.nss", source);
          const position = request(document, source.lastIndexOf("Global") + 2);
          const items = handlers.completion(position);
          expect(items.find((item: any) => item.label === "Global").kind).to.equal(CompletionItemKind.Variable);
          expect(items.find((item: any) => item.label === "Fixed").kind).to.equal(CompletionItemKind.Constant);
          expect(handlers.hover(position).contents.value).to.include(`${type} Global = ${value}`);
          const constant = handlers.hover(request(document, source.indexOf("Fixed") + 1));
          expect(constant.contents.value).to.include(`const ${type} Fixed = ${value}`);
          const signature = handlers.signature(request(document, source.indexOf("Fn(Global") + 3)).signatures[0];
          expect(signature.label).to.equal(`void Fn(${type} parameter = ${value})`);
          expect(signature.parameters[0].label).to.equal(`${type} parameter = ${value}`);
          const symbols = handlers.symbols(position);
          expect(symbols.find((symbol: any) => symbol.name === "Global").kind).to.equal(SymbolKind.Variable);
          expect(symbols.find((symbol: any) => symbol.name === "Fixed").kind).to.equal(SymbolKind.Constant);
          expect(symbols.filter((symbol: any) => symbol.name === "Fn")).to.have.length(1);
        });
      }
    }
  }

  for (const open of [false, true]) {
    for (const eol of ["\n", "\r\n"]) {
      it(`navigates to an included implementation with its source open=${String(open)}, eol=${JSON.stringify(eol)}`, () => {
        const { handlers, add, live } = editor();
        const helper = add("helper.nss", ["int Helper(int value);", "int Helper(int value) { return value; }"].join(eol), open);
        const source = '#include "helper"' + eol + "void main() { Helper(1); }";
        const current = add("current.nss", source);
        const position = request(current, source.indexOf("Helper(1)") + 2);
        expect(handlers.definition(position)).to.deep.equal({ uri: helper.uri, range: { start: { line: 1, character: 4 }, end: { line: 1, character: 4 } } });
        live.set(helper.uri, helper);
        TextDocument.update(helper, [{ text: eol + helper.getText() }], 2);
        expect(handlers.definition(position).range.start).to.deep.equal({ line: 2, character: 4 });
      });
    }
  }

  it("retains the indexed target if an included source disappears before navigation", () => {
    const { handlers, add } = editor();
    const helper = add("helper.nss", "int Helper(int value);", false);
    const source = '#include "helper"\nvoid main() { Helper(1); }';
    const current = add("current.nss", source);
    rmSync(join(root, "helper.nss"));
    expect(handlers.definition(request(current, source.indexOf("Helper(1)") + 2))).to.deep.equal({ uri: helper.uri, range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } } });
  });
});
