import { DocumentSymbol, SymbolKind } from "vscode-languageserver";

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
  public static buildItem(token: ComplexToken): DocumentSymbol {
    if (this.isConstantToken(token)) {
      return this.buildConstantItem(token);
    } else if (this.isVariableToken(token)) {
      return this.buildVariableItem(token);
    } else if (this.isFunctionParameterToken(token)) {
      return this.buildFunctionParamItem(token);
    } else if (this.isFunctionToken(token)) {
      return this.buildFunctionItem(token);
    } else if (this.isStructPropertyToken(token)) {
      return this.buildStructPropertyItem(token);
    } else if (this.isStructToken(token)) {
      return this.buildStructItem(token);
    } else {
      throw new Error("Invalid complex token. Cannot build symbol.");
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
      SymbolKind.TypeParameter,
      { start: token.position, end: token.position },
      { start: token.position, end: token.position },
    );
  }

  private static buildFunctionItem(token: FunctionComplexToken) {
    const paramSymbols = token.params.map((child) => SymbolBuilder.buildItem(child)) || [];
    const variableSymbols = token.variables?.map((child) => SymbolBuilder.buildItem(child)) || [];

    return DocumentSymbol.create(
      token.identifier,
      undefined,
      SymbolKind.Function,
      { start: token.position, end: token.position },
      { start: token.position, end: token.position },
      paramSymbols.concat(variableSymbols),
    );
  }

  private static buildStructPropertyItem(token: StructPropertyComplexToken) {
    return DocumentSymbol.create(
      token.identifier,
      undefined,
      SymbolKind.Property,
      { start: token.position, end: token.position },
      { start: token.position, end: token.position },
    );
  }

  private static buildStructItem(token: StructComplexToken) {
    const symbols = token.properties?.map((child) => SymbolBuilder.buildItem(child));

    return DocumentSymbol.create(
      token.identifier,
      undefined,
      SymbolKind.Struct,
      { start: token.position, end: token.position },
      { start: token.position, end: token.position },
      symbols,
    );
  }
}
