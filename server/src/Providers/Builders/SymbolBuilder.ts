import { CompletionItemKind, DocumentSymbol, SymbolKind } from "vscode-languageserver";

import type { Declaration, ConstantDeclaration, FunctionDeclaration, ParameterDeclaration, StructDeclaration, FieldDeclaration, VariableDeclaration } from "../../Parser/types";
import Builder from "./Builder";

export default class SymbolBuilder extends Builder {
  public static buildItem(token: Declaration, implicitConstants = false): DocumentSymbol {
    if (this.isConstantToken(token)) {
      return token.isConst || implicitConstants ? this.buildConstantItem(token) : this.buildVariableItem({ ...token, tokenType: CompletionItemKind.Variable });
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

  private static buildConstantItem(token: ConstantDeclaration) {
    return DocumentSymbol.create(token.identifier, undefined, SymbolKind.Constant, { start: token.position, end: token.position }, { start: token.position, end: token.position });
  }

  private static buildVariableItem(token: VariableDeclaration) {
    return DocumentSymbol.create(token.identifier, undefined, SymbolKind.Variable, { start: token.position, end: token.position }, { start: token.position, end: token.position });
  }

  private static buildFunctionParamItem(token: ParameterDeclaration) {
    return DocumentSymbol.create(token.identifier, undefined, SymbolKind.Variable, { start: token.position, end: token.position }, { start: token.position, end: token.position });
  }

  private static buildFunctionItem(token: FunctionDeclaration) {
    const paramSymbols = token.params.map((child) => SymbolBuilder.buildItem(child)) || [];
    const variableSymbols = token.variables?.map((child) => SymbolBuilder.buildItem(child)) || [];

    const children = paramSymbols.concat(variableSymbols);
    const end = children.reduce(
      (position, child) => (child.range.end.line > position.line || (child.range.end.line === position.line && child.range.end.character > position.character) ? child.range.end : position),
      token.position,
    );
    return DocumentSymbol.create(token.identifier, undefined, SymbolKind.Function, { start: token.position, end }, { start: token.position, end: token.position }, children);
  }

  private static buildStructPropertyItem(token: FieldDeclaration) {
    return DocumentSymbol.create(token.identifier, undefined, SymbolKind.Property, { start: token.position, end: token.position }, { start: token.position, end: token.position });
  }

  private static buildStructItem(token: StructDeclaration) {
    const symbols = token.properties?.map((child) => SymbolBuilder.buildItem(child));

    const end = symbols.reduce(
      (position, child) => (child.range.end.line > position.line || (child.range.end.line === position.line && child.range.end.character > position.character) ? child.range.end : position),
      token.position,
    );
    return DocumentSymbol.create(token.identifier, undefined, SymbolKind.Struct, { start: token.position, end }, { start: token.position, end: token.position }, symbols);
  }
}
