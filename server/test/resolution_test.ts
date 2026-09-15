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
        export { default as Definition } from './Providers/GotoDefinitionProvider';
        export { default as Hover } from './Providers/HoverContentProvider';
        export { default as Completion } from './Providers/CompletionItemsProvider';
        export { default as Symbols } from './Providers/SymbolsProvider';
        export { HoverContentBuilder, SignatureHelpBuilder, CompletionItemBuilder } from './Providers/Builders';
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

  it("omits absent global initializers from hover while preserving zero and empty strings", () => {
    const scope = tokenizer.tokenizeContent('int Global; int Zero = 0; string Empty = ""; const int Constant = 1;', "document");
    for (const markdown of [true, false]) {
      const expected = ["int Global", "int Zero = 0", 'string Empty = ""', "const int Constant = 1"];
      expect(scope.globalDeclarations.map((token: any) => api.HoverContentBuilder.buildItem(token, api.config, markdown).value)).to.deep.equal(
        expected.map((value) => (markdown ? `\`\`\`nwscript\r\n${value}\r\n\`\`\`` : value)),
      );
    }
  });

  for (const source of [
    "int Fn(int value);\nvoid Before() { Fn(1); }\nint Fn(int value) { return value; }\nvoid After() { Fn(2); }",
    "int Fn(int value) { return value; }\nvoid Before() { Fn(1); }\nint Fn(int value);\nvoid After() { Fn(2); }",
    "int Fn(int value); int Fn(int value); void Before() { Fn(1); } int Fn(int value) { return Fn(value); }",
    "int\nFn(int value);\nvoid Before() { Fn(1); }\nint\nFn(int value) { return value; }",
    "int Fn(int value) { return Fn(value); }",
    "int Fn(int value); void Before() { Fn(1); }",
  ]) {
    for (const newline of ["\n", "\r\n"]) {
      it(`navigates function calls and toggles prototype/implementation: ${JSON.stringify(source)}, newline=${JSON.stringify(newline)}`, () => {
        const document = TextDocument.create(workspaceUri("navigation.nss"), "nwscript", 1, source.replace(/\n/g, newline));
        const implementation = document.getText().indexOf("Fn(int value) {");
        const prototype = document.getText().indexOf("Fn(int value);");
        let handler: any;
        api.Definition.register({
          tokenizer,
          documentsCollection: new api.Collection(),
          liveDocumentsManager: { get: (uri: string) => (uri === document.uri ? document : undefined) },
          standardLibrary: { get: () => ({ globalDeclarations: [], structDeclarations: [] }) },
          connection: { onDefinition: (fn: any) => (handler = fn) },
          logger: {
            error: (message: string) => {
              throw new Error(message);
            },
          },
        });
        for (const occurrence of document.getText().matchAll(/Fn/g)) {
          const offset = occurrence.index ?? 0;
          const onImplementation = implementation === offset;
          const target = onImplementation && prototype >= 0 ? prototype : implementation >= 0 ? implementation : prototype;
          const expected = document.positionAt(target);
          expect(handler({ textDocument: { uri: document.uri }, position: document.positionAt(offset + 1) })).to.deep.equal({ uri: document.uri, range: { start: expected, end: expected } });
        }
      });
    }
  }

  function editor(source: string, filename = "details.nss", library: any = { globalDeclarations: [], structDeclarations: [] }) {
    const document = TextDocument.create(workspaceUri(filename), "nwscript", 1, source);
    const handlers: any = {};
    const server = {
      tokenizer,
      documentsCollection: new api.Collection(),
      liveDocumentsManager: { get: () => document },
      standardLibrary: { get: () => library },
      config: { ...api.config, completion: { ...api.config.completion, autoImport: false }, hovering: { addCommentsToFunctions: true } },
      capabilitiesHandler: { getSupportsMarkdownHover: () => true, getSupportsHierarchicalSymbols: () => true },
      connection: {
        onHover: (fn: any) => (handlers.hover = fn),
        onSignatureHelp: (fn: any) => (handlers.signature = fn),
        onCompletion: (fn: any) => (handlers.completion = fn),
        onCompletionResolve: () => {},
        onDocumentSymbol: (fn: any) => (handlers.symbols = fn),
      },
      logger: {
        error: (message: string) => {
          throw new Error(message);
        },
      },
    };
    for (const provider of [api.Hover, api.Signature, api.Completion, api.Symbols]) provider.register(server);
    return { document, handlers, params: (offset: number) => ({ textDocument: { uri: document.uri }, position: document.positionAt(offset) }) };
  }

  it("keeps prototype documentation, defaults and parameter names consistent across call sites", () => {
    const source = "// Public description\nint Fn(int publicName = 7);\nvoid Before() { Fn(1); }\nint Fn(int internalName) { return internalName; }\nvoid After() { Fn(2); }";
    const { handlers, params } = editor(source);
    const results = ["Fn(1)", "Fn(2)"].map((call) => {
      const offset = source.indexOf(call);
      return {
        hover: handlers.hover(params(offset + 1)),
        signature: handlers.signature(params(offset + 3)),
        completion: handlers.completion(params(offset + 1)).find((item: any) => item.label === "Fn"),
      };
    });
    expect(results[0]).to.deep.equal(results[1]);
    expect(results[0].hover.contents.value).to.include("Public description").and.include("int Fn(int publicName = 7)");
    expect(results[0].signature.signatures[0].label).to.equal("int Fn(int publicName = 7)");
    expect(results[0].completion.detail).to.include("publicName");
    const parameter = source.lastIndexOf("internalName");
    expect(handlers.hover(params(parameter + 1)).contents.value).to.include("int internalName");
  });

  for (const filename of ["details.nss", "nwscript.nss"]) {
    it(`distinguishes mutable globals from constants, including implicit API constants in ${filename}`, () => {
      const source = "int Global; const int Constant = 1; void main() {}";
      const library = tokenizer.tokenizeContent("int TRUE = 1;", "document");
      const { handlers, params } = editor(source, filename, library);
      const completions = handlers.completion(params(source.length));
      const global = completions.find((item: any) => item.label === "Global");
      expect(global.kind).to.equal(filename === "nwscript.nss" ? 21 : 6);
      if (filename !== "nwscript.nss") expect(global.detail).to.equal("(variable) Global: int");
      expect(completions.find((item: any) => item.label === "Constant").kind).to.equal(21);
      expect(completions.find((item: any) => item.label === "TRUE").kind).to.equal(21);
      const symbols = handlers.symbols(params(0));
      expect(symbols.find((item: any) => item.name === "Global").kind).to.equal(filename === "nwscript.nss" ? 14 : 13);
      expect(symbols.find((item: any) => item.name === "Constant").kind).to.equal(14);
    });
  }

  it("uses matching parameter labels with struct types and default values in signature help", () => {
    const source = 'struct Data { int value; }; void Take(struct Data input, int count = 0, string text = ""); void main() { struct Data data; Take(data, 0, ""); }';
    const { handlers, params } = editor(source);
    const signature = handlers.signature(params(source.indexOf("Take(data") + "Take(".length)).signatures[0];
    expect(signature.label).to.equal('void Take(struct Data input, int count = 0, string text = "")');
    expect(signature.parameters.map((parameter: any) => parameter.label)).to.deep.equal(["struct Data input", "int count = 0", 'string text = ""']);
  });

  it("refreshes declaration details across providers after unsaved edits", () => {
    const original = "int VALUE; void main() { VALUE; }";
    const { document, handlers, params } = editor(original);
    const sources = [original, "const int VALUE = 0; void main() { VALUE; }", original];
    for (const [index, source] of sources.entries()) {
      TextDocument.update(document, [{ text: source }], index + 2);
      const target = params(source.lastIndexOf("VALUE") + 1);
      const isConstant = index === 1;
      expect(handlers.completion(target).find((item: any) => item.label === "VALUE").kind).to.equal(isConstant ? 21 : 6);
      expect(handlers.symbols(target).find((item: any) => item.name === "VALUE").kind).to.equal(isConstant ? 14 : 13);
      expect(handlers.hover(target).contents.value).to.equal(`\`\`\`nwscript\r\n${isConstant ? "const int VALUE = 0" : "int VALUE"}\r\n\`\`\``);
    }
  });

  it("includes prototype-only functions in the outline without duplicating implemented functions", () => {
    const source = "int Prototype(int parameter);\nint Implemented(int oldName);\nint Implemented(int currentName) { return currentName; }";
    const { handlers, params } = editor(source);
    const symbols = handlers.symbols(params(0));
    expect(symbols.map((symbol: any) => symbol.name).sort()).to.deep.equal(["Implemented", "Prototype"]);
    expect(symbols.find((symbol: any) => symbol.name === "Prototype").selectionRange.start).to.deep.equal({ line: 0, character: 4 });
    expect(symbols.find((symbol: any) => symbol.name === "Implemented").selectionRange.start).to.deep.equal({ line: 2, character: 4 });
    expect(symbols.find((symbol: any) => symbol.name === "Implemented").children.map((child: any) => child.name)).to.deep.equal(["currentName"]);
  });

  it("presents value parameters as variables in completion and outline", () => {
    const source = "void Fn(int parameter) { parameter; }";
    const { handlers, params } = editor(source);
    const completions = handlers.completion(params(source.lastIndexOf("parameter") + 3));
    expect(completions.find((item: any) => item.label === "parameter").kind).to.equal(6);
    const symbol = handlers.symbols(params(0))[0].children.find((child: any) => child.name === "parameter");
    expect(symbol.kind).to.equal(13);
    expect(handlers.hover(params(source.lastIndexOf("parameter") + 3)).contents.value).to.include("int parameter");
  });

  for (const declaration of ["int Fn();", "void Fn(int value);", "void Fn(struct Data data, int count = 0);"]) {
    it(`resolves function completion repeatedly without appending duplicate parameters: ${declaration}`, () => {
      const fn = tokenizer.tokenizeContent(declaration, "document").globalDeclarations[0];
      const config = { ...api.config, completion: { ...api.config.completion, addParamsToFunctions: true } };
      const item = api.CompletionItemBuilder.buildItem(fn);
      const once = api.CompletionItemBuilder.buildResolvedItem(item, config);
      expect(once.label).to.equal(declaration.startsWith("int") ? "Fn()" : declaration.includes("struct") ? "Fn(struct Data data, int count)" : "Fn(int value)");
      expect(api.CompletionItemBuilder.buildResolvedItem(once, config)).to.deep.equal(once);
      expect(item.label).to.equal("Fn");
    });
  }

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
