import { workspaceUri } from "./support/fixtures";
import { before, describe, it } from "mocha";
import { expect } from "chai";
import { buildSync } from "esbuild";
import { join } from "path";
import { TextDocument } from "vscode-languageserver-textdocument";

describe("Document and signature resolution", () => {
  let api: any;
  let tokenizer: any;
  before(async () => {
    const bundle = join(__dirname, "../out/resolution-test.js");
    buildSync({
      stdin: {
        contents: `export { Tokenizer } from './Tokenizer';
        export { default as Collection } from './Documents/DocumentsCollection';
        export { default as Signature } from './Providers/SignatureHelpProvider';
        export { HoverContentBuilder } from './Providers/Builders';
        export { defaultServerConfiguration as config } from './ServerManager/Config';`,
        resolveDir: join(__dirname, "../src"),
        loader: "ts",
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
    });
    api = require(bundle);
    tokenizer = await new api.Tokenizer().loadGrammar();
  });

  it("indexes every same-line declaration with its own signature and value", () => {
    const scope = tokenizer.tokenizeContent("void First(int a) {} int Second(string b); void main() {} const int ONE = 1; const int TWO = 2;", "document");
    expect(scope.entryPointDeclarations.map((declaration: any) => declaration.identifier)).to.deep.equal(["main"]);
    expect(scope.globalDeclarations.map((token: any) => token.identifier)).to.deep.equal(["First", "Second", "ONE", "TWO"]);
    expect(scope.globalDeclarations[0].implementation).to.equal(true);
    expect(scope.globalDeclarations[1].implementation).to.equal(undefined);
    expect(scope.globalDeclarations[0].params.map((param: any) => param.identifier)).to.deep.equal(["a"]);
    expect(scope.globalDeclarations[1].params.map((param: any) => param.identifier)).to.deep.equal(["b"]);
    expect(scope.globalDeclarations.slice(2).map((token: any) => token.value)).to.deep.equal(["1", "2"]);
  });

  for (const source of [
    "struct Thing { int first; float second; }; void main() {}",
    "struct Thing {\n int first; float second;\n}; void main() {}",
    "struct Thing\n{\nint first;\nfloat second;\n}; void main() {}",
    "struct Thing /* name */\n /* body */ { int\n first; float second; }; void main() {}",
  ]) {
    it(`indexes struct fields and subsequent declarations: ${source}`, () => {
      const scope = tokenizer.tokenizeContent(source, "document");
      expect(scope.entryPointDeclarations.map((declaration: any) => declaration.identifier)).to.deep.equal(["main"]);
      expect(scope.structDeclarations.map((token: any) => token.identifier)).to.deep.equal(["Thing"]);
      expect(scope.structDeclarations[0].properties.map((token: any) => [token.identifier, token.valueType])).to.deep.equal([
        ["first", "int"],
        ["second", "float"],
      ]);
    });
  }

  for (const expression of ["Make(1)", "Make(Other(1))", "Make(1) + Other(2)", "Make(\n 1\n)"]) {
    it(`keeps global initializer calls out of function declarations: ${expression}`, () => {
      const source = `int FIRST = ${expression};\nint SECOND = Make(2);\nvoid After() {}`;
      const scope = tokenizer.tokenizeContent(source, "document");
      expect(scope.globalDeclarations.map((token: any) => token.identifier)).to.deep.equal(["FIRST", "SECOND", "After"]);
      const [lines, raw] = tokenizer.tokenizeContentToRaw(source);
      const local = tokenizer.tokenizeContentFromRaw(lines, raw, 0, lines.length - 1, lines.at(-1).length);
      expect(local.functionsComplexTokens.map((token: any) => token.identifier)).to.deep.equal(["After"]);
    });
  }

  it("retains declared types across aligned whitespace", () => {
    const scope = tokenizer.tokenizeContent("const int   VALUE = 1;\nfloat\t\tOther();", "document");
    expect(scope.globalDeclarations[0].valueType).to.equal("int");
    expect(scope.globalDeclarations[1].returnType).to.equal("float");
  });

  it("does not classify decimal literals as member accesses", () => {
    const scope = tokenizer.tokenizeContent("float PI = 3.141592; void Fn(float n = 2.0); void main() { float x = 0.5; }", "document");
    expect(scope.memberReferences).to.equal(undefined);
    expect(scope.globalDeclarations[0].value).to.equal("3.141592");
    expect(scope.globalDeclarations[1].params[0].defaultValue).to.equal("2.0");
  });

  for (const [type, value] of [
    ["int", "fallback"],
    ["vector", "[1.0, 2.0, 3.0]"],
    ["string", '"a,b"'],
  ]) {
    for (const spacing of ["", " ", "\n"]) {
      it(`keeps default expressions out of the parameter list: ${type}, ${value}, spacing=${JSON.stringify(spacing)}`, () => {
        const scope = tokenizer.tokenizeContent(`const int fallback=1; void Fn(${type} value${spacing}=${spacing}${value}, int next=2);`, "document");
        const fn = scope.globalDeclarations.find((token: any) => token.identifier === "Fn");
        expect(fn.params.map((param: any) => [param.identifier, param.valueType, param.defaultValue])).to.deep.equal([
          ["value", type, value],
          ["next", "int", "2"],
        ]);
      });
    }
  }

  for (const separator of ["\n", " /* type */ ", "\n /* type */\n"]) {
    for (const type of ["int", "struct Data", "struct constructor"]) {
      it(`reads return and parameter types across ${JSON.stringify(separator)}: ${type}`, () => {
        const scope = tokenizer.tokenizeContent(`struct Data { int field; }; struct constructor { int field; };\n${type}${separator}Fn(${type}${separator}value);`, "document");
        const fn = scope.globalDeclarations.find((token: any) => token.identifier === "Fn");
        expect(fn.returnType).to.equal(type.replace("struct ", ""));
        expect(fn.params.map((param: any) => [param.identifier, param.valueType])).to.deep.equal([["value", type.replace("struct ", "")]]);
        expect(api.HoverContentBuilder.buildItem(fn, api.config).value).to.include(`${type} Fn(${type} value)`);
      });
    }
  }

  it("distinguishes struct definitions from struct field and return types", () => {
    const scope = tokenizer.tokenizeContent("struct Child { int value; };\nstruct Parent { struct Child child; };\nstruct Child GetChild();", "document");
    expect(scope.structDeclarations.map((token: any) => token.identifier)).to.deep.equal(["Child", "Parent"]);
    expect(scope.structDeclarations[1].properties[0].valueType).to.equal("Child");
    expect(scope.globalDeclarations[0].identifier).to.equal("GetChild");
    expect(scope.globalDeclarations[0].returnType).to.equal("Child");
  });

  for (const [source, names] of [
    ["void Previous() { string hidden; }\nvoid main() {\n int visible;\n |\n}", ["visible"]],
    ["void main() {\n int outer;\n { string inner; }\n |\n}", ["outer"]],
    ["void main() { int before; | int after; }", ["before"]],
    ["int Fn(int value|);", ["value"]],
    ["int Fn(int value); |", []],
    ["int Fn(int value); void Next(float other|);", ["other"]],
    ["int Fn(int value); void main() { | }", []],
    ["void main() { int outer; { string inner; | } }", ["inner", "outer"]],
    ["void main() { int a = Pair(1, 2), b = 3; | }", ["a", "b"]],
    ["void main() { vector a = [1.0, 2.0, 3.0], b; | }", ["a", "b"]],
    ['void main() { string a = "x,y;{}", b = "text"; | }', ["a", "b"]],
  ] as const) {
    it(`tracks lexical scope and declaration lists: ${source}`, () => {
      const document = TextDocument.create(workspaceUri("test.nss"), "nwscript", 1, source.replace("|", ""));
      const position = document.positionAt(source.indexOf("|"));
      const [lines, raw] = tokenizer.tokenizeContentToRaw(document.getText());
      const scope = tokenizer.tokenizeContentFromRaw(lines, raw, 0, position.line, position.character);
      expect(scope.functionVariablesComplexTokens.map((token: any) => token.identifier)).to.deep.equal(names);
    });
  }

  it("keeps comma-separated global values and struct fields distinct", () => {
    const scope = tokenizer.tokenizeContent("int first = 1, second = 2;\nstruct Thing { int FIRST, SECOND; string third, fourth; };", "document");
    expect(scope.globalDeclarations.map((token: any) => [token.identifier, token.value])).to.deep.equal([
      ["first", "1"],
      ["second", "2"],
    ]);
    expect(scope.structDeclarations[0].properties.map((token: any) => [token.identifier, token.valueType])).to.deep.equal([
      ["FIRST", "int"],
      ["SECOND", "int"],
      ["third", "string"],
      ["fourth", "string"],
    ]);
  });

  it("does not resolve identifiers inside comments or string literals", () => {
    for (const text of ['void main() { string value = "VALUE"; }', "void main() { /* VALUE */ }"]) {
      const [lines, raw] = tokenizer.tokenizeContentToRaw(text);
      expect(tokenizer.getActionTargetAtPosition(lines, raw, { line: 0, character: text.indexOf("VALUE") + 2 }).rawContent).to.equal(undefined);
    }
  });

  for (const [source, expected] of [
    ["global.|", ["global", ""]],
    ["local.child.fi|eld", ["local", "child", "field"]],
    ["value. /* comment */ child.|", ["value", "child", ""]],
    ["value\n .child.|", ["value", "child", ""]],
    ["Call(value.child.|", ["value", "child", ""]],
    ["first + second|", undefined],
    ['"value.field|"', undefined],
    ["// value.field|", undefined],
  ] as const) {
    it(`reads member access from tokens: ${source}`, () => {
      const document = TextDocument.create(workspaceUri("member.nss"), "nwscript", 1, source.replace("|", ""));
      const [lines, raw] = tokenizer.tokenizeContentToRaw(document.getText());
      expect(tokenizer.getMemberAccessFromRaw(lines, raw, document.positionAt(source.indexOf("|")))).to.deep.equal(expected);
    });
  }

  for (const [call, identifier, activeParameter] of [
    ["First(1); Second(2, |3);", "Second", 1],
    ["Second(First(1), |3);", "Second", 1],
    ["Second(First(|1), 3);", "First", 0],
    ["Second(\n First(1),\n |3\n);", "Second", 1],
    ["Second(1, (|3));", "Second", 1],
    ['Second("a,b", |3);', "Second", 1],
    ["Second([1.0, 2.0, |3.0], 4);", "Second", 0],
    ["Second([1.0, 2.0, 3.0], |4);", "Second", 1],
  ] as const) {
    it(`resolves the enclosing call and parses once: ${call}`, () => {
      const marked = `int First(int a);\nint Second(int a, int b);\nvoid main() {\n ${call}\n}\n`;
      const live = TextDocument.create(workspaceUri("current.nss"), "nwscript", 1, marked.replace("|", ""));
      const collection = new api.Collection();
      collection.createDocument(live.uri, tokenizer.tokenizeContent(live.getText(), "document"));
      let handler: any;
      api.Signature.register({
        tokenizer,
        documentsCollection: collection,
        liveDocumentsManager: { get: () => live },
        standardLibrary: { get: () => ({ globalDeclarations: [], structDeclarations: [] }) },
        config: api.config,
        connection: { onSignatureHelp: (fn: any) => (handler = fn) },
        logger: {
          error: (message: string) => {
            throw new Error(message);
          },
        },
      });
      const tokenize = tokenizer.tokenizeContentToRaw.bind(tokenizer);
      let parses = 0;
      tokenizer.tokenizeContentToRaw = (...args: any[]) => {
        parses++;
        return tokenize(...args);
      };
      try {
        const result = handler({ textDocument: { uri: live.uri }, position: live.positionAt(marked.indexOf("|")) });
        expect(result.signatures[0].label).to.include(` ${identifier}(`);
        expect(result.activeParameter).to.equal(activeParameter);
        expect(parses).to.equal(1);
      } finally {
        tokenizer.tokenizeContentToRaw = tokenize;
      }
    });
  }

  for (const encodedFirst of [false, true]) {
    it(`normalizes document identity for updates and deletion (encodedFirst=${String(encodedFirst)})`, () => {
      const collection = new api.Collection();
      const uri = workspaceUri("helper.nss");
      const alternate = uri.replace("helper.nss", "%68elper.nss").replace(/\/([A-Za-z]):/, "/$1%3A");
      const first = encodedFirst ? alternate : uri;
      const second = encodedFirst ? uri : alternate;
      collection.createDocument(first, tokenizer.tokenizeContent("void Before() {}", "document"));
      collection.updateDocument(TextDocument.create(second, "nwscript", 1, "void After() {}"), tokenizer, {});
      expect(collection.getWorkspaceDocuments()).to.have.length(1);
      expect(collection.getFromUri(first)).to.equal(collection.getFromUri(second));
      expect(collection.resolveInclude("helper").globalDeclarations[0].identifier).to.equal("After");
      collection.removeDocument(first);
      expect(collection.getFromUri(second)).to.equal(undefined);
      expect(collection.resolveInclude("helper")).to.equal(undefined);
    });
  }

  it("shares cycle-safe traversal, preserves owners, and selects a duplicate after deletion", () => {
    const collection = new api.Collection();
    const add = (uri: string, text: string) => collection.createDocument(uri, tokenizer.tokenizeContent(text, "document"));
    add(workspaceUri("constructor.nss"), '#include "CYCLE"\nvoid First() {}');
    add(workspaceUri("other/constructor.nss"), "void Replacement() {}");
    add(workspaceUri("cycle.nss"), '#include "CONSTRUCTOR"\nstruct Value {\n int member;\n};');
    const document = collection.getFromUri(workspaceUri("constructor.nss"));
    expect(document.getChildren()).to.deep.equal(["cycle"]);
    expect(document.getGlobalComplexTokensWithRef()[0].owner).to.equal(document.uri);
    expect(document.getGlobalComplexTokens().map((token: any) => token.identifier)).to.deep.equal(["First"]);
    expect(document.getGlobalStructComplexTokens().map((token: any) => token.identifier)).to.deep.equal(["Value"]);
    collection.removeDocument(document.uri);
    expect(collection.get("CONSTRUCTOR").globalDeclarations[0].identifier).to.equal("Replacement");
    expect(collection.getFromUri(document.uri)).to.equal(undefined);
  });
});
