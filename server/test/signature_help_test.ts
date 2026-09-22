import { describe, it } from "mocha";
import { expect } from "chai";
import { DeclarationKind, BuiltinType } from "../src/Language";
import type { FunctionDeclaration } from "../src/Language";
import SignatureHelpBuilder from "../src/Providers/Builders/SignatureHelpBuilder";

describe("Signature help", () => {
  const declaration: FunctionDeclaration = {
    identifier: "Example",
    kind: DeclarationKind.Function,
    returnType: BuiltinType.void,
    position: { line: 0, character: 0 },
    comments: [],
    params: ["first", "second"].map((identifier) => ({
      identifier,
      kind: DeclarationKind.Parameter,
      valueType: BuiltinType.int,
      position: { line: 0, character: 0 },
    })),
  };

  it("selects the first parameter with index zero", () => {
    expect(SignatureHelpBuilder.buildFunctionItem(declaration, 0).activeParameter).to.equal(0);
  });

  it("preserves a later parameter index", () => {
    expect(SignatureHelpBuilder.buildFunctionItem(declaration, 1).activeParameter).to.equal(1);
  });

  it("omits an unknown active parameter from the protocol response", () => {
    const response = JSON.parse(JSON.stringify(SignatureHelpBuilder.buildFunctionItem(declaration, undefined)));
    expect(response).not.to.have.property("activeParameter");
  });
});
