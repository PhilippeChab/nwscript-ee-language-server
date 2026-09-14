import { before, describe, it } from "mocha";
import { expect } from "chai";
import { buildSync } from "esbuild";
import { join } from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItem } from "vscode-languageserver";

describe("Auto-import completion", function () {
  this.timeout(10000);
  let api: any;
  let tokenizer: any;
  before(async () => {
    const bundle = join(__dirname, "../out/auto-import-test.js");
    buildSync({
      stdin: {
        contents: `export { default as Collection } from './Documents/DocumentsCollection';
          export { Tokenizer } from './Tokenizer';
          export { default as Completion } from './Providers/CompletionItemsProvider';
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

  const complete = (source: string, scripts: Record<string, string> = {}, enabled = true, indexedSource?: string, addParamsToFunctions = true) => {
    const cursor = source.indexOf("|");
    const text = source.replace("|", "");
    const live = TextDocument.create("file:///workspace/current.nss", "nwscript", 1, text);
    const collection = new api.Collection();
    for (const [name, content] of Object.entries({ helper: "void Imported(int value);\nconst int IMPORTED_VALUE = 1;\nstruct ImportedStruct {\n int value;\n};\n", ...scripts })) {
      collection.createDocument(`file:///workspace/${name}.nss`, tokenizer.tokenizeContent(content, "global"));
    }
    collection.createDocument(live.uri, tokenizer.tokenizeContent(indexedSource === undefined ? text : indexedSource, "global"));
    const handlers: any = {};
    api.Completion.register({
      documentsCollection: collection,
      tokenizer,
      config: { ...api.config, completion: { autoImport: enabled, addParamsToFunctions } },
      standardLibrary: { get: () => ({ complexTokens: [], structComplexTokens: [] }) },
      liveDocumentsManager: { get: () => live },
      logger: {
        error: (message: string) => {
          throw new Error(message);
        },
      },
      connection: {
        onCompletion: (fn: any) => (handlers.complete = fn),
        onCompletionResolve: (fn: any) => (handlers.resolve = fn),
      },
    });
    const items: CompletionItem[] = handlers.complete({ textDocument: { uri: live.uri }, position: live.positionAt(cursor) });
    return { items, live, resolve: handlers.resolve };
  };

  it("adds an include after the header and preserves it during function resolution", () => {
    const { items, live, resolve } = complete("// Header\nvoid main()\n{\n Imp|\n}\n");
    const item = items.find((item) => item.label === "Imported");
    expect(item?.detail).to.include('#include "helper"');
    const resolved = resolve(item);
    expect(resolved.label).to.equal("Imported(int value)");
    expect(TextDocument.applyEdits(live, [resolved.textEdit, ...resolved.additionalTextEdits])).to.equal('// Header\n#include "helper"\nvoid main()\n{\n Imported(int value)\n}\n');
    expect(TextDocument.applyEdits(live, resolved.additionalTextEdits)).to.equal('// Header\n#include "helper"\nvoid main()\n{\n Imp\n}\n');
    expect(items.find((item) => item.label === "IMPORTED_VALUE")?.additionalTextEdits).to.have.length(1);
  });

  it("preserves CRLF and appends after existing includes", () => {
    const { items, live } = complete('#include "other" // comment\r\n\r\nvoid main()\r\n{\r\n Imp|\r\n}\r\n');
    const edits = items.find((item) => item.label === "Imported")?.additionalTextEdits || [];
    expect(TextDocument.applyEdits(live, edits)).to.include('// comment\r\n\r\n#include "helper"\r\nvoid main()');
  });

  for (const include of ['#include "helper"', '#include "wrapper"', '# include "helper" // trailing comment', '#include "helper" /* trailing comment */']) {
    it(`avoids importing symbols already available through ${include}`, () => {
      const { items } = complete(`${include}\nvoid main()\n{\n Imp|\n}`, { wrapper: '#include "helper"\n' });
      expect(items.filter((item) => item.label === "Imported")).to.have.length(1);
      expect(items.find((item) => item.label === "Imported")).not.to.have.property("additionalTextEdits");
    });
  }

  it("ignores includes inside comments", () => {
    const { items } = complete('/*\n#include "helper"\n*/\nvoid main()\n{\n Imp|\n}');
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  it("uses unsaved include additions and removals without changing the index", () => {
    const plain = "void main()\n{\n Imp|\n}";
    const included = `#include "helper"\n${plain}`;
    const added = complete(included, {}, true, plain.replace("|", ""));
    expect(added.items.filter((item) => item.label === "Imported")).to.have.length(1);
    expect(added.items.find((item) => item.label === "Imported")).not.to.have.property("additionalTextEdits");
    const removed = complete(plain, {}, true, included.replace("|", ""));
    expect(removed.items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  for (const declaration of [
    { source: "const int IMPORTED_VALUE = 42;", identifier: "IMPORTED_VALUE", prefix: "IMPORTED_V" },
    { source: "void Imported(int value);", identifier: "Imported", prefix: "Import" },
    { source: "struct ImportedStruct {\n int localValue;\n};", identifier: "ImportedStruct", prefix: "struct ImportedS" },
  ]) {
    it(`uses the unsaved ${declaration.identifier} declaration instead of a conflicting import`, () => {
      const saved = "void main()\n{\n}\n";
      const source = `${declaration.source}\nvoid main()\n{\n ${declaration.prefix}|\n}\n`;
      const { items } = complete(source, {}, true, saved);
      const matches = items.filter((item) => item.label === declaration.identifier);
      expect(matches).to.have.length(1);
      expect(matches[0]).not.to.have.property("additionalTextEdits");
      expect(matches[0]).not.to.have.property("textEdit");
    });
  }

  it("offers imports again after a global declaration is removed without saving", () => {
    const { items } = complete("void main()\n{\n IMPORTED_V|\n}\n", {}, true, "const int IMPORTED_VALUE = 42;\nvoid main()\n{\n}\n");
    expect(items.find((item) => item.label === "IMPORTED_VALUE")?.additionalTextEdits).to.have.length(1);
  });

  for (const entryPoint of ["void main() {}", "int StartingConditional() { return 1; }"]) {
    it(`excludes all symbols from a source with a conflicting ${entryPoint}`, () => {
      const { items } = complete(
        `void Caller()\n{\n Imp|\n}\n${entryPoint}\n`,
        { executable: `void ImportedFromExecutable();\nconst int EXECUTABLE_VALUE = 1;\n${entryPoint}\n` },
        true,
        "void Caller() {}\n",
      );
      expect(items.some((item) => item.detail?.includes('#include "executable"'))).to.equal(false);
      expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
    });
  }

  it("detects entry point conflicts through includes on both sides", () => {
    const { items } = complete('#include "current_entry"\nvoid Caller()\n{\n Imp|\n}\n', {
      current_entry: "void main() {}\n",
      other_entry: "void main() {}\n",
      executable: '#include "other_entry"\nvoid ImportedFromExecutable();\n',
    });
    expect(items.some((item) => item.label === "ImportedFromExecutable")).to.equal(false);
  });

  it("does not treat an entry point prototype as an implementation", () => {
    const { items } = complete("void main()\n{\n Imp|\n}\n", { helper: "void main();\nvoid Imported(int value);\n" });
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  it("allows a candidate whose entry point comes only from an already included dependency", () => {
    const { items } = complete('#include "shared_entry"\nvoid Caller()\n{\n Imp|\n}\n', {
      shared_entry: "void main() {}\n",
      helper: '#include "shared_entry"\nvoid Imported(int value);\n',
    });
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  it("allows an entry point when the requesting script no longer has one", () => {
    const { items } = complete("void Caller()\n{\n Imp|\n}\n", { helper: "void Imported(int value);\nvoid main() {}\n" }, true, "void main() {}\n");
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  for (const source of ["Imp|", "|", "// Header\nImp|"]) {
    it(`applies a completion and include at the same position in ${JSON.stringify(source)}`, () => {
      const { items, live, resolve } = complete(source);
      const item = resolve(items.find((item) => item.label === "Imported"));
      expect(item.additionalTextEdits).to.equal(undefined);
      expect(TextDocument.applyEdits(live, [item.textEdit])).to.equal(`${source.startsWith("//") ? "// Header\n" : ""}#include "helper"\nImported(int value)`);
    });
  }

  it("replaces the complete identifier at the cursor and respects the parameter setting", () => {
    const { items, live, resolve } = complete("void main()\n{\n Imp|orted\n}", {}, true, undefined, false);
    const item = resolve(items.find((item) => item.label === "Imported"));
    expect(TextDocument.applyEdits(live, [item.textEdit, ...item.additionalTextEdits])).to.equal('#include "helper"\nvoid main()\n{\n Imported\n}');
  });

  it("uses bundled includes and honors workspace overrides", () => {
    const source = "void main()\n{\n Get|\n}";
    const bundled = complete(source);
    expect(bundled.items.some((item) => item.detail?.includes('#include "inc_mf_combat"'))).to.equal(true);
    const overridden = complete(source, { inc_mf_combat: "void WorkspaceHelper();\n" });
    const matching = overridden.items.filter((item) => item.detail?.includes('#include "inc_mf_combat"'));
    expect(matching.map((item) => item.label)).to.deep.equal(["WorkspaceHelper"]);
  });

  it("does not suggest imports from the current script or implicit nwscript", () => {
    const { items } = complete("void OwnFunction();\nvoid main()\n{\n Imp|\n}", { nwscript: "void ImplicitFunction();\n", "other/current": "void OtherCurrent();\n" });
    expect(items.some((item) => item.detail?.includes('#include "current"') || item.detail?.includes('#include "nwscript"'))).to.equal(false);
  });

  it("offers distinct sources for the same symbol", () => {
    const { items } = complete("void main()\n{\n Imp|\n}", { alternate: "void Imported(int value);\n" });
    expect(items.filter((item) => item.label === "Imported")).to.have.length(2);
  });

  it("does not insert inside a header comment that ends beside code", () => {
    const { items, live } = complete("/* Header\n */ void main()\n{\n Imp|\n}");
    const edits = items.find((item) => item.label === "Imported")?.additionalTextEdits || [];
    expect(TextDocument.applyEdits(live, edits)).to.equal('/* Header\n */\n#include "helper"\n void main()\n{\n Imp\n}');
  });

  it("avoids cycles and local symbol conflicts", () => {
    const { items } = complete("void Imported(int value);\nvoid main()\n{\n Imp|\n}", { cycle: '#include "current"\nvoid Cyclic();\n' });
    expect(items.find((item) => item.label === "Imported")).not.to.have.property("additionalTextEdits");
    expect(items.some((item) => item.label === "Cyclic")).to.equal(false);
  });

  for (const expression of ["// Imp|", "/* Imp| */", 'string s = "Imp|";', "value.Imp|", "value. |", '#include "Imp|"']) {
    it(`suppresses auto-imports in ${expression}`, () => {
      const { items } = complete(`void main()\n{\n ${expression}\n}`);
      expect(items.some((item) => item.additionalTextEdits)).to.equal(false);
    });
  }

  it("supports struct type completions", () => {
    const { items } = complete("void main()\n{\n struct Imp|\n}");
    expect(items.find((item) => item.label === "ImportedStruct")?.additionalTextEdits).to.have.length(1);
    expect(items.some((item) => item.label === "Imported")).to.equal(false);
  });

  it("recognizes includes by grammar scopes in both indexing and live completion", () => {
    const source = '# include "helper" /* tail */\n// #include "fake"\n/*\n#include "also_fake"\n*/\n#include "unfinished\n';
    const [lines, tokens] = tokenizer.tokenizeContentToRaw(source);
    expect(tokenizer.getIncludesFromRaw(lines, tokens)).to.deep.equal(["helper"]);
    expect(tokenizer.tokenizeContent(source, "global").children).to.deep.equal(["helper"]);
  });

  it("can be disabled", () => {
    const { items } = complete("void main()\n{\n Imp|\n}", {}, false);
    expect(items.some((item) => item.additionalTextEdits)).to.equal(false);
  });
});
