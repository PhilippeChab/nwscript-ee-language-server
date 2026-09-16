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

  protected static isConstantToken(token: Declaration): token is ConstantDeclaration {
    return token.tokenType === CompletionItemKind.Constant;
  }

  protected static isVariableToken(token: Declaration): token is VariableDeclaration {
    return token.tokenType === CompletionItemKind.Variable;
  }

  protected static isFunctionParameterToken(token: Declaration): token is ParameterDeclaration {
    return token.tokenType === CompletionItemKind.TypeParameter;
  }

  protected static isFunctionToken(token: Declaration): token is FunctionDeclaration {
    return token.tokenType === CompletionItemKind.Function;
  }

  protected static isStructPropertyToken(token: Declaration): token is FieldDeclaration {
    return token.tokenType === CompletionItemKind.Property;
  }

  protected static isStructToken(token: Declaration): token is StructDeclaration {
    return token.tokenType === CompletionItemKind.Struct;
  }
}
