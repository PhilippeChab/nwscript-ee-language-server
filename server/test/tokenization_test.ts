import { describe, before } from "mocha";
import { expect } from "chai";
import { readFileSync, writeFileSync } from "fs";
import { normalize, join } from "path";
import Tokenizer, {
  GlobalScopeTokenizationResult,
  LocalScopeTokenizationResult,
  TokenizedScope,
} from "../src/Tokenizer/Tokenizer";

const format = (data: any) => JSON.parse(JSON.stringify(data));

describe("Tokenization", () => {
  let tokenizer: Tokenizer;
  let staticCode: string;
  let staticGlobalTokens: GlobalScopeTokenizationResult;
  let staticLocalTokensWithContext: LocalScopeTokenizationResult;
  let staticLocalTokensWithoutContext: LocalScopeTokenizationResult;

  before("Read static data", async () => {
    tokenizer = await new Tokenizer(true).loadGrammar();
    staticCode = readFileSync(normalize(join(__dirname, "./static/test.nss"))).toString();
    staticGlobalTokens = JSON.parse(
      readFileSync(normalize(join(__dirname, "./static/globalScopeTokens.json"))).toString(),
    ) as GlobalScopeTokenizationResult;
    staticLocalTokensWithContext = JSON.parse(
      readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithContext.json"))).toString(),
    ) as LocalScopeTokenizationResult;
    staticLocalTokensWithoutContext = JSON.parse(
      readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithoutContext.json"))).toString(),
    ) as LocalScopeTokenizationResult;
  });

  describe("Global Scope", () => {
    let definitions: GlobalScopeTokenizationResult;
    before("Tokenize Content", () => {
      definitions = format(tokenizer.tokenizeContent(staticCode, TokenizedScope.global));
    });

    it("should equal static children", () => {
      expect(definitions.children).to.be.deep.equal(staticGlobalTokens.children);
    });

    it("should equal static struct tokens", () => {
      expect(definitions.structComplexTokens).to.be.deep.equal(staticGlobalTokens.structComplexTokens);
    });

    it("should equal static constant and function tokens", () => {
      expect(definitions.complexTokens).to.be.deep.equal(staticGlobalTokens.complexTokens);
    });
  });

  describe("Local Scope with current function context", () => {
    let definitions: LocalScopeTokenizationResult;
    before("Tokenize Content", () => {
      definitions = format(tokenizer.tokenizeContent(staticCode, TokenizedScope.local, 0, 293));
    });

    it("should equal static function variables tokens", () => {
      expect(definitions.functionVariablesComplexTokens).to.be.deep.equal(
        staticLocalTokensWithContext.functionVariablesComplexTokens,
      );
    });

    it("should equal static function tokens", () => {
      expect(definitions.functionsComplexTokens).to.be.deep.equal(staticLocalTokensWithContext.functionsComplexTokens);
    });
  });

  describe("Local Scope with entire file context", () => {
    let definitions: LocalScopeTokenizationResult;
    before("Tokenize Content", () => {
      definitions = format(tokenizer.tokenizeContent(staticCode, TokenizedScope.local));
    });

    it("should equal static function variables tokens", () => {
      expect(definitions.functionVariablesComplexTokens).to.be.deep.equal(
        staticLocalTokensWithoutContext.functionVariablesComplexTokens,
      );
    });

    it("should equal static function tokens", () => {
      expect(definitions.functionsComplexTokens).to.be.deep.equal(staticLocalTokensWithoutContext.functionsComplexTokens);
    });
  });
});
