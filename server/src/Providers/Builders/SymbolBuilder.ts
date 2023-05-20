import { DocumentSymbol, SymbolInformation, SymbolKind } from "vscode-languageserver";

import type {
  ComplexToken,
  ConstantComplexToken,
  FunctionComplexToken,
  FunctionParamComplexToken,
  StructComplexToken,
  StructPropertyComplexToken,
  VariableComplexToken,
} from "../../Tokenizer/types";
import Builder from "./Builder";

export default class SymbolBuilder extends Builder {
  public static buildItem(token: ComplexToken, children?: ComplexToken[]): DocumentSymbol {
    if (this.isConstantToken(token)) {
      return this.buildConstantItem(token);
    } else if (this.isVariableToken(token)) {
      return this.buildVariableItem(token);
    } else if (this.isFunctionParameterToken(token)) {
      return this.buildFunctionParamItem(token);
    } else if (this.isFunctionToken(token)) {
      return this.buildFunctionItem(token, children);
    } else if (this.isStructPropertyToken(token)) {
      throw new Error("Invalid token");
      // return this.buildStructPropertyItem(token, uri);
    } else if (this.isStructToken(token)) {
      throw new Error("Invalid token");
      // return this.buildStructItem(token, uri);
    } else {
      throw new Error("Invalid token");
    }
  }

  private static buildConstantItem(token: ConstantComplexToken) {
    return DocumentSymbol.create(
      token.identifier,
      undefined,
      SymbolKind.Constant,
      { start: token.position, end: token.position },
      { start: token.position, end: token.position },
    );
  }

  private static buildVariableItem(token: VariableComplexToken) {
    return DocumentSymbol.create(
      token.identifier,
      undefined,
      SymbolKind.Variable,
      { start: token.position, end: token.position },
      { start: token.position, end: token.position },
    );
  }

  private static buildFunctionParamItem(token: FunctionParamComplexToken) {
    return DocumentSymbol.create(
      token.identifier,
      undefined,
      SymbolKind.Variable,
      { start: token.position, end: token.position },
      { start: token.position, end: token.position },
    );
  }

  private static buildFunctionItem(token: FunctionComplexToken, children?: ComplexToken[]) {
    const symbols = children?.map((child) => SymbolBuilder.buildItem(child));

    return DocumentSymbol.create(
      token.identifier,
      undefined,
      SymbolKind.Function,
      { start: token.position, end: token.position },
      { start: token.position, end: token.position },
      symbols,
    );
  }

  // private static buildStructPropertyItem(token: StructPropertyComplexToken, uri?: string) {
  // }

  // private static buildStructItem(token: StructComplexToken, uri?: string) {
  // }
}
