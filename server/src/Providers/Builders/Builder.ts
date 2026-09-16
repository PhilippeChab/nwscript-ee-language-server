import { CompletionItemKind } from "vscode-languageserver";

import { LanguageTypes } from "../../Parser/constants";
import type { Declaration, ConstantDeclaration, VariableDeclaration, ParameterDeclaration, FunctionDeclaration, FieldDeclaration, StructDeclaration } from "../../Parser/types";

export default abstract class Builder {
  protected static formatParameter(param: ParameterDeclaration) {
    return `${this.handleLanguageType(param.valueType)} ${param.identifier}${param.defaultValue !== undefined ? ` = ${param.defaultValue}` : ""}`;
  }

  protected static handleLanguageType(type: string) {
    if (!Object.prototype.hasOwnProperty.call(LanguageTypes, type)) {
      return `struct ${type}`;
    }

    return type;
  }

  protected static isConstantDeclaration(declaration: Declaration): declaration is ConstantDeclaration {
    return declaration.kind === CompletionItemKind.Constant;
  }

  protected static isVariableDeclaration(declaration: Declaration): declaration is VariableDeclaration {
    return declaration.kind === CompletionItemKind.Variable;
  }

  protected static isParameterDeclaration(declaration: Declaration): declaration is ParameterDeclaration {
    return declaration.kind === CompletionItemKind.TypeParameter;
  }

  protected static isFunctionDeclaration(declaration: Declaration): declaration is FunctionDeclaration {
    return declaration.kind === CompletionItemKind.Function;
  }

  protected static isFieldDeclaration(declaration: Declaration): declaration is FieldDeclaration {
    return declaration.kind === CompletionItemKind.Property;
  }

  protected static isStructDeclaration(declaration: Declaration): declaration is StructDeclaration {
    return declaration.kind === CompletionItemKind.Struct;
  }
}
