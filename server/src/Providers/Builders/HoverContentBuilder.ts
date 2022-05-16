import { CompletionItemKind, MarkupContent, MarkupKind } from "vscode-languageserver";
import type {
  ComplexToken,
  ConstantComplexToken,
  FunctionComplexToken,
  FunctionParamComplexToken,
  VariableComplexToken,
} from "../../Tokenizer/types";
import Builder from "./Builder";

export default class HoverContentBuilder extends Builder {
  public static buildItem(token: ComplexToken): MarkupContent {
    if (this.isConstantToken(token)) {
      return this.buildConstant(token);
    } else if (this.isVariable(token)) {
      return this.buildVariable(token);
    } else if (this.isFunctionParameter(token)) {
      return this.buildFunctionParam(token);
    } else if (this.isFunctionToken(token)) {
      return this.buildFunction(token);
    } else {
      return this.buildMarkdown("");
    }
  }

  private static buildConstant(token: ConstantComplexToken) {
    return this.buildMarkdown(
      `${this.prependStruct(token.data.valueType)}${token.data.valueType} ${token.data.identifier} = ${token.data.value}`
    );
  }

  private static buildVariable(token: VariableComplexToken) {
    return this.buildMarkdown(`${this.prependStruct(token.data.valueType)}${token.data.valueType} ${token.data.identifier}`);
  }

  private static buildFunctionParam(token: FunctionParamComplexToken) {
    return this.buildMarkdown(`${this.prependStruct(token.data.valueType)}${token.data.valueType} ${token.data.identifier}`);
  }

  private static buildFunction(token: FunctionComplexToken) {
    return this.buildMarkdown(
      `${this.prependStruct(token.data.returnType)}${token.data.returnType} ${token.data.identifier}(${token.data.params.reduce(
        (acc, param, index) => {
          return `${acc}${param.valueType} ${param.identifier}${index === token.data.params.length - 1 ? "" : ", "}`;
        },
        ""
      )})`
    );
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

  private static buildMarkdown(content: string) {
    return {
      kind: MarkupKind.Markdown,
      value: ["```nwscript", content, "```"].join("\n"),
    };
  }
}
