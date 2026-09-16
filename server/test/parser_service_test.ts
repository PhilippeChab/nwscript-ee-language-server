import { describe, before } from "mocha";
import { expect } from "chai";
import { readFileSync } from "fs";
import { normalize, join } from "path";
import readDocumentIndex from "../src/Documents/readDocumentIndex";
import ParserService, { DocumentIndex, LocalScope, AnalysisMode } from "../src/Parser/ParserService";

// Preserve the legacy editor-token comparisons; declaration-order metadata is
// exercised by the import behavior tests, including first-signature parameters.
const format = (data: any) => JSON.parse(JSON.stringify(data, (key, value) => (key === "signatureEnd" ? undefined : value)));

describe("ParserService", () => {
  let parserService: ParserService;
  let staticCode: string;
  let staticGlobalTokens: DocumentIndex;
  let staticLocalTokensWithContext: LocalScope;
  let staticLocalTokensWithoutContext: LocalScope;

  before("Read static data", async () => {
    parserService = await new ParserService(true).loadGrammar();
    staticCode = readFileSync(normalize(join(__dirname, "./static/test.nss"))).toString();
    staticGlobalTokens = readDocumentIndex(readFileSync(normalize(join(__dirname, "./static/globalScopeTokens.json")), "utf8"));
    staticLocalTokensWithContext = JSON.parse(readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithContext.json"))).toString()) as LocalScope;
    staticLocalTokensWithoutContext = JSON.parse(readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithoutContext.json"))).toString()) as LocalScope;
  });

  describe("Global Scope", () => {
    let definitions: DocumentIndex;
    before("Tokenize Content", () => {
      definitions = format(parserService.analyzeContent(staticCode, AnalysisMode.document));
    });

    it("should equal static includes", () => {
      expect(definitions.includes.map(({ name }) => name)).to.deep.equal(staticGlobalTokens.includes.map(({ name }) => name));
      staticGlobalTokens.includes.forEach((include, i) => {
        if (include.position) expect(definitions.includes[i].position).to.deep.equal(include.position);
      });
    });

    it("should equal static struct tokens", () => {
      expect(definitions.structDeclarations).to.be.deep.equal(staticGlobalTokens.structDeclarations);
    });

    it("should equal static constant and function tokens", () => {
      expect(definitions.globalDeclarations).to.be.deep.equal(staticGlobalTokens.globalDeclarations);
    });
  });

  describe("Local Scope with current function context", () => {
    let definitions: LocalScope;
    before("Tokenize Content", () => {
      definitions = format(parserService.analyzeContent(staticCode, AnalysisMode.local, 0, 292));
    });

    it("should equal static function variables tokens", () => {
      expect(definitions.variableDeclarations).to.be.deep.equal(staticLocalTokensWithContext.variableDeclarations);
    });

    it("should equal static function tokens", () => {
      expect(definitions.functionDeclarations).to.be.deep.equal(staticLocalTokensWithContext.functionDeclarations);
    });
  });

  describe("Local Scope with entire file context", () => {
    let definitions: LocalScope;
    before("Tokenize Content", () => {
      definitions = format(parserService.analyzeContent(staticCode, AnalysisMode.local));
    });

    it("should equal static function variables tokens", () => {
      expect(definitions.variableDeclarations).to.be.deep.equal(staticLocalTokensWithoutContext.variableDeclarations);
    });

    it("should equal static function tokens", () => {
      expect(definitions.functionDeclarations).to.be.deep.equal(staticLocalTokensWithoutContext.functionDeclarations);
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
