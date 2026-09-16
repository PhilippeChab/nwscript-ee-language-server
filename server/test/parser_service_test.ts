import { describe, before } from "mocha";
import { expect } from "chai";
import { readFileSync } from "fs";
import { normalize, join } from "path";
import readDocumentIndex from "../src/Documents/readDocumentIndex";
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
    staticLocalScopeWithContext = JSON.parse(readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithContext.json"))).toString()) as LocalScope;
    staticLocalScopeWithoutContext = JSON.parse(readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithoutContext.json"))).toString()) as LocalScope;
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

  it("reads current include entries with and without source positions", () => {
    const index = { globalDeclarations: [], structDeclarations: [], includes: [{ name: "Helper", position: { line: 3, character: 1 } }, { name: "Other" }] };
    expect(readDocumentIndex(JSON.stringify(index))).to.deep.equal(index);
  });
});
