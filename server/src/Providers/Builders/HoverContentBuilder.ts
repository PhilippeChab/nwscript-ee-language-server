import { MarkupContent, MarkupKind } from "vscode-languageserver";
import { ServerConfiguration } from "../../ServerManager/Config";
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
  public static buildItem(token: ComplexToken, serverConfig: ServerConfiguration): MarkupContent {
    if (this.isConstantToken(token)) {
      return this.buildConstantItem(token);
    } else if (this.isVariable(token)) {
      return this.buildVariableItem(token);
    } else if (this.isFunctionParameter(token)) {
      return this.buildFunctionParamItem(token);
    } else if (this.isFunctionToken(token)) {
      return this.buildFunctionItem(token, serverConfig);
    } else if (this.isStructPropertyToken(token)) {
      return this.buildStructPropertyItem(token);
    } else if (this.isStructToken(token)) {
      return this.buildStructItem(token);
    } else {
      return this.buildMarkdown("");
    }
  }

  private static buildConstantItem(token: ConstantComplexToken) {
    return this.buildMarkdown(`${this.handleLanguageType(token.valueType)} ${token.identifier} = ${token.value}`);
  }

  private static buildVariableItem(token: VariableComplexToken) {
    return this.buildMarkdown(`${this.handleLanguageType(token.valueType)} ${token.identifier}`);
  }

  private static buildFunctionParamItem(token: FunctionParamComplexToken) {
    return this.buildMarkdown(`${this.handleLanguageType(token.valueType)} ${token.identifier}`);
  }

  private static buildFunctionItem(token: FunctionComplexToken, serverConfig: ServerConfiguration) {
    return this.buildMarkdown(
      [
        `${this.handleLanguageType(token.returnType)} ${token.identifier}(${token.params.reduce((acc, param, index) => {
          return `${acc}${this.handleLanguageType(param.valueType)} ${param.identifier}${
            index === token.params.length - 1 ? "" : ", "
          }`;
        }, "")})`,
      ],
      serverConfig.includeCommentsInFunctionsHover ? ["```nwscript", ...token.comments, "```"] : [],
      []
    );
  }

  private static buildStructPropertyItem(property: StructPropertyComplexToken) {
    return this.buildMarkdown(`${this.handleLanguageType(property.valueType)} ${property.identifier}`);
  }

  private static buildStructItem(token: StructComplexToken) {
    return this.buildMarkdown([
      `struct ${token.identifier}`,
      "{",
      ...token.properties.map((property) => `\t${property.valueType} ${property.identifier}`),
      "}",
    ]);
  }

  private static buildMarkdown(content: string[] | string, prepend: string[] = [], postpend: string[] = []) {
    let formattedContent = content;
    if (typeof content === "string") {
      formattedContent = [content];
    }

    return {
      kind: MarkupKind.Markdown,
      value: prepend
        .concat(["```nwscript", ...formattedContent, "```"])
        .concat(postpend)
        .join("\r\n"),
    };
  }
}
