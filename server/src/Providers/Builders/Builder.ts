import { DeclarationKind, isBuiltinType } from "../../Language";
import type { Declaration, ConstantDeclaration, VariableDeclaration, ParameterDeclaration, FunctionDeclaration, FieldDeclaration, StructDeclaration } from "../../Language";

export default abstract class Builder {
  protected static formatParameter(param: ParameterDeclaration) {
    return `${this.handleLanguageType(param.valueType)} ${param.identifier}${param.defaultValue !== undefined ? ` = ${param.defaultValue}` : ""}`;
  }

  protected static handleLanguageType(type: string) {
    if (!isBuiltinType(type)) {
      return `struct ${type}`;
    }

    return type;
  }

  protected static isConstantDeclaration(declaration: Declaration): declaration is ConstantDeclaration {
    return declaration.kind === DeclarationKind.Constant;
  }

  protected static isVariableDeclaration(declaration: Declaration): declaration is VariableDeclaration {
    return declaration.kind === DeclarationKind.Variable;
  }

  protected static isParameterDeclaration(declaration: Declaration): declaration is ParameterDeclaration {
    return declaration.kind === DeclarationKind.Parameter;
  }

  protected static isFunctionDeclaration(declaration: Declaration): declaration is FunctionDeclaration {
    return declaration.kind === DeclarationKind.Function;
  }

  protected static isFieldDeclaration(declaration: Declaration): declaration is FieldDeclaration {
    return declaration.kind === DeclarationKind.Field;
  }

  protected static isStructDeclaration(declaration: Declaration): declaration is StructDeclaration {
    return declaration.kind === DeclarationKind.Struct;
  }
}
