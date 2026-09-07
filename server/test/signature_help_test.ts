import { describe, it } from "mocha";
import { expect } from "chai";
import { CompletionItemKind } from "vscode-languageserver";
import SignatureHelpBuilder from "../src/Providers/Builders/SignatureHelpBuilder";
import { LanguageTypes } from "../src/Tokenizer/constants";
import type { FunctionComplexToken } from "../src/Tokenizer/types";

describe("Signature help", () => {
  const token: FunctionComplexToken = {
    identifier: "Example",
    tokenType: CompletionItemKind.Function,
    returnType: LanguageTypes.void,
    position: { line: 0, character: 0 },
    comments: [],
    params: ["first", "second"].map((identifier) => ({
      identifier,
      tokenType: CompletionItemKind.TypeParameter,
      valueType: LanguageTypes.int,
      position: { line: 0, character: 0 },
    })),
  };

  it("selects the first parameter with index zero", () => {
    expect(SignatureHelpBuilder.buildFunctionItem(token, 0).activeParameter).to.equal(0);
  });

  it("preserves a later parameter index", () => {
    expect(SignatureHelpBuilder.buildFunctionItem(token, 1).activeParameter).to.equal(1);
  });

  it("omits an unknown active parameter from the protocol response", () => {
    const response = JSON.parse(JSON.stringify(SignatureHelpBuilder.buildFunctionItem(token, undefined)));
    expect(response).not.to.have.property("activeParameter");
  });
});
