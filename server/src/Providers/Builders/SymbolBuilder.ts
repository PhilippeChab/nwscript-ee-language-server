import { DeclarationKind } from "../../Parser/types";
import { DocumentSymbol, SymbolKind } from "vscode-languageserver";

import type { Declaration, ConstantDeclaration, FunctionDeclaration, ParameterDeclaration, StructDeclaration, FieldDeclaration, VariableDeclaration } from "../../Parser/types";
import Builder from "./Builder";

export default class SymbolBuilder extends Builder {
  public static buildItem(declaration: Declaration, implicitConstants = false): DocumentSymbol {
    if (this.isConstantDeclaration(declaration)) {
      return declaration.isConst || implicitConstants ? this.buildConstantItem(declaration) : this.buildVariableItem({ ...declaration, kind: DeclarationKind.Variable });
    } else if (this.isVariableDeclaration(declaration)) {
      return this.buildVariableItem(declaration);
    } else if (this.isParameterDeclaration(declaration)) {
      return this.buildFunctionParamItem(declaration);
    } else if (this.isFunctionDeclaration(declaration)) {
      return this.buildFunctionItem(declaration);
    } else if (this.isFieldDeclaration(declaration)) {
      return this.buildStructPropertyItem(declaration);
    } else if (this.isStructDeclaration(declaration)) {
      return this.buildStructItem(declaration);
    } else {
      throw new Error("Invalid declaration. Cannot build symbol.");
    }
  }

  private static buildConstantItem(declaration: ConstantDeclaration) {
    return DocumentSymbol.create(
      declaration.identifier,
      undefined,
      SymbolKind.Constant,
      { start: declaration.position, end: declaration.position },
      { start: declaration.position, end: declaration.position },
    );
  }

  private static buildVariableItem(declaration: VariableDeclaration) {
    return DocumentSymbol.create(
      declaration.identifier,
      undefined,
      SymbolKind.Variable,
      { start: declaration.position, end: declaration.position },
      { start: declaration.position, end: declaration.position },
    );
  }

  private static buildFunctionParamItem(declaration: ParameterDeclaration) {
    return DocumentSymbol.create(
      declaration.identifier,
      undefined,
      SymbolKind.Variable,
      { start: declaration.position, end: declaration.position },
      { start: declaration.position, end: declaration.position },
    );
  }

  private static buildFunctionItem(declaration: FunctionDeclaration) {
    const paramSymbols = declaration.params.map((child) => SymbolBuilder.buildItem(child)) || [];
    const variableSymbols = declaration.variables?.map((child) => SymbolBuilder.buildItem(child)) || [];

    const children = paramSymbols.concat(variableSymbols);
    const end = children.reduce(
      (position, child) => (child.range.end.line > position.line || (child.range.end.line === position.line && child.range.end.character > position.character) ? child.range.end : position),
      declaration.position,
    );
    return DocumentSymbol.create(declaration.identifier, undefined, SymbolKind.Function, { start: declaration.position, end }, { start: declaration.position, end: declaration.position }, children);
  }

  private static buildStructPropertyItem(declaration: FieldDeclaration) {
    return DocumentSymbol.create(
      declaration.identifier,
      undefined,
      SymbolKind.Property,
      { start: declaration.position, end: declaration.position },
      { start: declaration.position, end: declaration.position },
    );
  }

  private static buildStructItem(declaration: StructDeclaration) {
    const symbols = declaration.properties?.map((child) => SymbolBuilder.buildItem(child));

    const end = symbols.reduce(
      (position, child) => (child.range.end.line > position.line || (child.range.end.line === position.line && child.range.end.character > position.character) ? child.range.end : position),
      declaration.position,
    );
    return DocumentSymbol.create(declaration.identifier, undefined, SymbolKind.Struct, { start: declaration.position, end }, { start: declaration.position, end: declaration.position }, symbols);
  }
}
