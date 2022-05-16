import { MarkupContent, MarkupKind } from "vscode-languageserver";
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

export default class HoverContentBuilder extends Builder {
  public static buildItem(token: ComplexToken): MarkupContent {
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
      return this.buildSimpleMarkdown("");
    }
  }

  private static buildConstantItem(token: ConstantComplexToken) {
    return this.buildSimpleMarkdown(`${this.handleLanguageType(token.valueType)} ${token.identifier} = ${token.value}`);
  }

  private static buildVariableItem(token: VariableComplexToken) {
    return this.buildSimpleMarkdown(`${this.handleLanguageType(token.valueType)} ${token.identifier}`);
  }

  private static buildFunctionParamItem(token: FunctionParamComplexToken) {
    return this.buildSimpleMarkdown(`${this.handleLanguageType(token.valueType)} ${token.identifier}`);
  }

  private static buildFunctionItem(token: FunctionComplexToken) {
    return this.buildSimpleMarkdown(
      `${this.handleLanguageType(token.returnType)} ${token.identifier}(${token.params.reduce((acc, param, index) => {
        return `${acc}${this.handleLanguageType(param.valueType)} ${param.identifier}${
          index === token.params.length - 1 ? "" : ", "
        }`;
      }, "")})`
    );
  }

  private static buildStructPropertyItem(property: StructPropertyComplexToken) {
    return this.buildSimpleMarkdown(`${this.handleLanguageType(property.valueType)} ${property.identifier}`);
  }

  private static buildStructItem(token: StructComplexToken) {
    return this.buildComposedMarkdown([
      `struct ${token.identifier}`,
      "{",
      ...token.properties.map((property) => `\t${property.valueType} ${property.identifier}`),
      "}",
    ]);
  }

  private static buildSimpleMarkdown(content: string) {
    return {
      kind: MarkupKind.Markdown,
      value: ["```nwscript", content, "```"].join("\n"),
    };
  }

  private static buildComposedMarkdown(content: string[]) {
    return {
      kind: MarkupKind.Markdown,
      value: ["```nwscript"].concat(content).concat(["```"]).join("\n"),
    };
  }
}
