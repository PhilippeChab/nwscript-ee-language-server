import { TextDocument } from "vscode-languageserver-textdocument";
import { DeclarationKind, ReferenceKind } from "../src/Parser/types";
import { describe, before } from "mocha";
import { expect } from "chai";
import { readFileSync } from "fs";
import { normalize, join } from "path";
import readDocumentIndex, { reviveDeclaration } from "../src/Documents/readDocumentIndex";
import ParserService, { DocumentIndex, LocalScope, AnalysisMode } from "../src/Parser/ParserService";

// Preserve the legacy declaration comparisons; declaration-order metadata is
// exercised by the import behavior tests, including first-signature parameters.
const format = (data: any) => JSON.parse(JSON.stringify(data, (key, value) => (key === "signatureEnd" ? undefined : value)));

describe("ParserService", () => {
  let parserService: ParserService;
  let staticCode: string;
  let staticDocumentIndex: DocumentIndex;
  let staticLocalScopeWithContext: LocalScope;
  let staticLocalScopeWithoutContext: LocalScope;

  before("Read static data", async () => {
    parserService = await new ParserService(true).loadGrammar();
    staticCode = readFileSync(normalize(join(__dirname, "./static/test.nss"))).toString();
    staticDocumentIndex = readDocumentIndex(readFileSync(normalize(join(__dirname, "./static/globalScopeTokens.json")), "utf8"));
    staticLocalScopeWithContext = JSON.parse(readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithContext.json"))).toString(), reviveDeclaration) as LocalScope;
    staticLocalScopeWithoutContext = JSON.parse(readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithoutContext.json"))).toString(), reviveDeclaration) as LocalScope;
  });

  it("classifies global and local variables independently of constants", () => {
    const index = parserService.analyzeContent("int Global = 1; const int Fixed = 2; void main() { int local; }", AnalysisMode.document);
    expect(index.globalDeclarations[0]).to.include({ kind: DeclarationKind.Variable, scope: "global", value: "1" });
    expect(index.globalDeclarations[1]).to.include({ kind: DeclarationKind.Constant, isConst: true });
    expect(index.localDeclarations?.[0]).to.include({ kind: DeclarationKind.Variable, scope: "local" });
  });

  it("classifies implicit API constants in one-shot and cached live parses", () => {
    const document = TextDocument.create("file:///NWScript.NSS", "nwscript", 1, "int TRUE = 1;");
    const expected = { kind: DeclarationKind.Constant, identifier: "TRUE", value: "1" };
    expect(parserService.analyzeContent(document, AnalysisMode.document).globalDeclarations[0]).to.include(expected);
    const syntax = parserService.parse(document);
    expect(syntax.getIndex().globalDeclarations[0]).to.include(expected);
    TextDocument.update(document, [{ text: "int TRUE = 2;" }], 2);
    expect(parserService.parse(document)).to.equal(syntax);
    expect(syntax.getIndex().globalDeclarations[0]).to.include({ ...expected, value: "2" });
  });

  it("keeps unnamed documents parseable", () => {
    const document = TextDocument.create("untitled:Untitled-1", "nwscript", 1, "int Value;");
    expect(parserService.getDocumentIndex(document).globalDeclarations[0]).to.include({ kind: DeclarationKind.Variable, scope: "global" });
  });

  describe("Global Scope", () => {
    let definitions: DocumentIndex;
    before("Parse Content", () => {
      definitions = format(parserService.analyzeContent(staticCode, AnalysisMode.document));
    });

    it("should equal static includes", () => {
      expect(definitions.includes.map(({ name }) => name)).to.deep.equal(staticDocumentIndex.includes.map(({ name }) => name));
      staticDocumentIndex.includes.forEach((include, i) => {
        if (include.position) expect(definitions.includes[i].position).to.deep.equal(include.position);
      });
    });

    it("should equal static struct declarations", () => {
      expect(definitions.structDeclarations).to.be.deep.equal(staticDocumentIndex.structDeclarations);
    });

    it("should equal static constant and function declarations", () => {
      expect(definitions.globalDeclarations).to.be.deep.equal(staticDocumentIndex.globalDeclarations);
    });
  });

  describe("Local Scope with current function context", () => {
    let definitions: LocalScope;
    before("Parse Content", () => {
      definitions = format(parserService.analyzeContent(staticCode, AnalysisMode.local, 0, 292));
    });

    it("should equal static local variable declarations", () => {
      expect(definitions.variableDeclarations).to.be.deep.equal(staticLocalScopeWithContext.variableDeclarations);
    });

    it("should equal static function declarations", () => {
      expect(definitions.functionDeclarations).to.be.deep.equal(staticLocalScopeWithContext.functionDeclarations);
    });
  });

  describe("Local Scope with entire file context", () => {
    let definitions: LocalScope;
    before("Parse Content", () => {
      definitions = format(parserService.analyzeContent(staticCode, AnalysisMode.local));
    });

    it("should equal static local variable declarations", () => {
      expect(definitions.variableDeclarations).to.be.deep.equal(staticLocalScopeWithoutContext.variableDeclarations);
    });

    it("should equal static function declarations", () => {
      expect(definitions.functionDeclarations).to.be.deep.equal(staticLocalScopeWithoutContext.functionDeclarations);
    });
  });
});

describe("Serialized document indexes", () => {
  it("distinguishes legacy mutable globals from explicit and implicit constants", () => {
    for (const discriminator of [{ tokenType: 21 }, { kind: DeclarationKind.Constant }]) {
      const content = JSON.stringify({
        includes: [],
        structDeclarations: [],
        globalDeclarations: [
          { identifier: "Global", ...discriminator, value: "1" },
          { identifier: "Fixed", ...discriminator, value: "2", isConst: true },
        ],
      });
      const index = readDocumentIndex(content);
      expect(index.globalDeclarations[0]).to.include({ kind: DeclarationKind.Variable, scope: "global", value: "1" });
      expect(index.globalDeclarations[1]).to.include({ kind: DeclarationKind.Constant, isConst: true });
      expect(readDocumentIndex(content, true).globalDeclarations[0].kind).to.equal(DeclarationKind.Constant);
      expect(readDocumentIndex(JSON.stringify(index))).to.deep.equal(index);
    }
  });

  it("reads legacy include arrays without retaining duplicate fields", () => {
    const declarations = { globalDeclarations: [], structDeclarations: [] };
    const position = { line: 3, character: 1 };
    expect(readDocumentIndex(JSON.stringify({ ...declarations, children: ["NWSCRIPT", "Helper"], includePositions: [{ line: 0, character: 0 }, position] }))).to.deep.equal({
      ...declarations,
      includes: [
        { name: "NWSCRIPT", position: { line: 0, character: 0 } },
        { name: "Helper", position },
      ],
    });
    expect(readDocumentIndex(JSON.stringify({ ...declarations, children: ["Helper"] }))).to.deep.equal({ ...declarations, includes: [{ name: "Helper" }] });
  });

  it("converts legacy kinds in nested declarations and references without changing strings", () => {
    const legacy = {
      children: [],
      globalDeclarations: [{ identifier: "Fn", tokenType: 3, params: [{ identifier: "arg", tokenType: 25 }], comments: ['tokenType: 3; "tokenType": 3'] }],
      structDeclarations: [{ identifier: "Data", tokenType: 22, properties: [{ identifier: "field", tokenType: 10 }] }],
      localDeclarations: [{ identifier: "local", tokenType: 6 }],
      memberReferences: [{ identifier: "field", tokenType: 18 }],
      entryPointDeclarations: [{ identifier: "main", tokenType: 3 }],
    };
    const current = {
      includes: [],
      globalDeclarations: [{ identifier: "Fn", kind: DeclarationKind.Function, params: [{ identifier: "arg", kind: DeclarationKind.Parameter }], comments: legacy.globalDeclarations[0].comments }],
      structDeclarations: [{ identifier: "Data", kind: DeclarationKind.Struct, properties: [{ identifier: "field", kind: DeclarationKind.Field }] }],
      localDeclarations: [{ identifier: "local", kind: DeclarationKind.Variable, scope: "local" }],
      memberReferences: [{ identifier: "field", kind: ReferenceKind.Member }],
      entryPointDeclarations: [{ identifier: "main", kind: DeclarationKind.Function }],
    };
    expect(readDocumentIndex(JSON.stringify(legacy))).to.deep.equal(current);
    expect(readDocumentIndex(JSON.stringify(current))).to.deep.equal(current);
    expect(JSON.parse('{"kind":18,"targetKind":"struct","identifier":"Data"}', reviveDeclaration)).to.deep.equal({ kind: ReferenceKind.Type, identifier: "Data" });
    expect(JSON.parse('{"kind":3,"identifier":"Fn"}', reviveDeclaration)).to.deep.equal({ kind: DeclarationKind.Function, identifier: "Fn" });
  });

  it("reads current include entries with and without source positions", () => {
    const index = { globalDeclarations: [], structDeclarations: [], includes: [{ name: "Helper", position: { line: 3, character: 1 } }, { name: "Other" }] };
    expect(readDocumentIndex(JSON.stringify(index))).to.deep.equal(index);
  });
});
