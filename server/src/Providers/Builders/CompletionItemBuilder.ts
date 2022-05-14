import { CompletionItem, CompletionItemKind } from "vscode-languageserver";
import { ComplexToken, ConstantComplexToken, FunctionComplexToken, StructComplexToken } from "../../tokenizer/types";

export class CompletionItemBuilder {
  public static buildStructTypeItem(token: StructComplexToken): CompletionItem {
    return {
      label: token.data.identifier,
      kind: token.data.tokenType,
      detail: `(struct) ${token.data.identifier}`,
    };
  }

  public static buildItem(token: ComplexToken): CompletionItem {
    if (this.isConstantToken(token)) {
      return this.buildConstant(token);
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

  private static buildFunction(token: FunctionComplexToken): CompletionItem {
    return {
      label: token.data.identifier,
      kind: token.data.tokenType,
      detail: `(method) (${token.data.params.reduce((acc, param, index) => {
        return `${acc} ${param.identifier} :${param.paramType}${index === token.data.params.length - 1 ? "" : ","}`;
      }, "")}) :${token.data.returnType}`,
    };
  }

  private static isConstantToken(token: ComplexToken): token is ConstantComplexToken {
    return token.data.tokenType === CompletionItemKind.Constant;
  }

  private static isFunctionToken(token: ComplexToken): token is FunctionComplexToken {
    return token.data.tokenType === CompletionItemKind.Function;
  }
}
