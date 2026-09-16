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
    return declaration.tokenType === CompletionItemKind.Constant;
  }

  protected static isVariableDeclaration(declaration: Declaration): declaration is VariableDeclaration {
    return declaration.tokenType === CompletionItemKind.Variable;
  }

  protected static isParameterDeclaration(declaration: Declaration): declaration is ParameterDeclaration {
    return declaration.tokenType === CompletionItemKind.TypeParameter;
  }

  protected static isFunctionDeclaration(declaration: Declaration): declaration is FunctionDeclaration {
    return declaration.tokenType === CompletionItemKind.Function;
  }

  protected static isFieldDeclaration(declaration: Declaration): declaration is FieldDeclaration {
    return declaration.tokenType === CompletionItemKind.Property;
  }

  protected static isStructDeclaration(declaration: Declaration): declaration is StructDeclaration {
    return declaration.tokenType === CompletionItemKind.Struct;
  }
}
