import { CompletionItem, CompletionItemKind } from "vscode-languageserver";
import type {
  ComplexToken,
  ConstantComplexToken,
  FunctionComplexToken,
  FunctionParamComplexToken,
  LanguageStructProperty,
  StructComplexToken,
  VariableComplexToken,
} from "../../Tokenizer/types";

export class CompletionItemBuilder {
  public static buildStructPropertyItem(property: LanguageStructProperty): CompletionItem {
    return {
      label: property.identifier,
      kind: property.tokenType,
      detail: `(property) ${property.identifier} :${property.valueType}`,
    };
  }

  public static buildStructIdentifierItem(token: StructComplexToken): CompletionItem {
    return {
      label: token.data.identifier,
      kind: token.data.tokenType,
      detail: `(struct) ${token.data.identifier}`,
    };
  }

  public static buildItem(token: ComplexToken): CompletionItem {
    if (this.isConstantToken(token)) {
      return this.buildConstant(token);
    } else if (this.isVariable(token)) {
      return this.buildVariable(token);
    } else if (this.isFunctionParameter(token)) {
      return this.buildFunctionParam(token);
    } else if (this.isFunctionToken(token)) {
      return this.buildFunction(token);
    } else {
      return {
        label: "",
      };
    }
  }

  private static buildConstant(token: ConstantComplexToken): CompletionItem {
    return {
      label: token.data.identifier,
      kind: token.data.tokenType,
      detail: `(constant) ${token.data.value} :${token.data.valueType}`,
    };
  }

  private static buildVariable(token: VariableComplexToken): CompletionItem {
    return {
      label: token.data.identifier,
      kind: token.data.tokenType,
      detail: `(variable) ${token.data.identifier} :${token.data.valueType}`,
    };
  }

  private static buildFunctionParam(token: FunctionParamComplexToken): CompletionItem {
    return {
      label: token.data.identifier,
      kind: token.data.tokenType,
      detail: `(param) ${token.data.identifier} :${token.data.valueType}`,
    };
  }

  private static buildFunction(token: FunctionComplexToken): CompletionItem {
    return {
      label: token.data.identifier,
      kind: token.data.tokenType,
      detail: `(method) (${token.data.params.reduce((acc, param, index) => {
        return `${acc} ${param.identifier} :${param.valueType}${index === token.data.params.length - 1 ? "" : ","}`;
      }, "")}) :${token.data.returnType}`,
    };
  }

  private static isConstantToken(token: ComplexToken): token is ConstantComplexToken {
    return token.data.tokenType === CompletionItemKind.Constant;
  }

  private static isVariable(token: ComplexToken): token is VariableComplexToken {
    return token.data.tokenType === CompletionItemKind.Variable;
  }

  private static isFunctionParameter(token: ComplexToken): token is FunctionParamComplexToken {
    return token.data.tokenType === CompletionItemKind.TypeParameter;
  }

  private static isFunctionToken(token: ComplexToken): token is FunctionComplexToken {
    return token.data.tokenType === CompletionItemKind.Function;
  }
}
