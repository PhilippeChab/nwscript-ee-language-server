import { CompletionItem, CompletionItemKind } from "vscode-languageserver";
import { ServerConfiguration } from "../../ServerManager/ServerManager";
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

export default class CompletionItemBuilder extends Builder {
  public static buildResolvedItem(item: CompletionItem, serverConfig: ServerConfiguration): CompletionItem {
    if (serverConfig.autoCompleteFunctionsWithParams && item.kind === CompletionItemKind.Function) {
      const params = item.data as FunctionParamComplexToken[];

      return {
        label: `${item.label}(${params.reduce((acc, param, index) => {
          return `${acc}${this.handleLanguageType(param.valueType)} ${param.identifier}${
            index === params.length - 1 ? "" : ", "
          }`;
        }, "")})`,
        kind: item.kind,
        detail: item.detail,
      };
    }

    return item;
  }

  public static buildItem(token: ComplexToken): CompletionItem {
    if (this.isConstantToken(token)) {
      return this.buildConstantItem(token);
    } else if (this.isVariable(token)) {
      return this.buildVariableItem(token);
    } else if (this.isFunctionParameter(token)) {
      return this.buildFunctionParamItem(token);
    } else if (this.isFunctionToken(token)) {
      return this.buildFunctionItem(token);
    } else if (this.isStructPropertyToken(token)) {
      return this.buildStructPropertyItem(token);
    } else if (this.isStructToken(token)) {
      return this.buildStructItem(token);
    } else {
      return {
        label: "",
      };
    }
  }

  private static buildConstantItem(token: ConstantComplexToken): CompletionItem {
    return {
      label: token.identifier,
      kind: token.tokenType,
      detail: `(constant) ${token.value}: ${this.handleLanguageType(token.valueType)}`,
    };
  }

  private static buildVariableItem(token: VariableComplexToken): CompletionItem {
    return {
      label: token.identifier,
      kind: token.tokenType,
      detail: `(variable) ${token.identifier}: ${this.handleLanguageType(token.valueType)}`,
    };
  }

  private static buildFunctionParamItem(token: FunctionParamComplexToken): CompletionItem {
    return {
      label: token.identifier,
      kind: token.tokenType,
      detail: `(param) ${token.identifier}: ${this.handleLanguageType(token.valueType)}`,
    };
  }

  private static buildFunctionItem(token: FunctionComplexToken): CompletionItem {
    return {
      label: token.identifier,
      kind: token.tokenType,
      detail: `(method) (${token.params.reduce((acc, param, index) => {
        return `${acc}${param.identifier}: ${this.handleLanguageType(param.valueType)}${
          index === token.params.length - 1 ? "" : ", "
        }`;
      }, "")}): ${this.handleLanguageType(token.returnType)}`,
      data: token.params,
    };
  }

  private static buildStructPropertyItem(property: StructPropertyComplexToken): CompletionItem {
    return {
      label: property.identifier,
      kind: property.tokenType,
      detail: `(property) ${property.identifier}: ${this.handleLanguageType(property.valueType)}`,
    };
  }

  private static buildStructItem(token: StructComplexToken): CompletionItem {
    return {
      label: token.identifier,
      kind: token.tokenType,
      detail: `(struct) ${token.identifier}`,
    };
  }
}
