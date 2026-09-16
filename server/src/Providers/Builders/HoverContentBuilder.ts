import { MarkupContent, MarkupKind } from "vscode-languageserver";

import type { Declaration, ConstantDeclaration, FunctionDeclaration, ParameterDeclaration, StructDeclaration, FieldDeclaration, VariableDeclaration } from "../../Parser/types";
import { ServerConfiguration } from "../../ServerManager/Config";
import Builder from "./Builder";

export default class HoverContentBuilder extends Builder {
  public static buildItem(token: Declaration, serverConfig: ServerConfiguration, markdown = true): MarkupContent {
    const content = this.buildRichItem(token, serverConfig);
    return markdown
      ? content
      : {
          kind: MarkupKind.PlainText,
          value: content.value
            .split("\r\n")
            .filter((line) => line !== "```" && line !== "```nwscript")
            .join("\n"),
        };
  }

  private static buildRichItem(token: Declaration, serverConfig: ServerConfiguration): MarkupContent {
    if (this.isConstantToken(token)) {
      return this.buildConstantItem(token);
    } else if (this.isVariableToken(token)) {
      return this.buildVariableItem(token);
    } else if (this.isFunctionParameterToken(token)) {
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

  private static buildConstantItem(token: ConstantDeclaration) {
    return this.buildMarkdown(`${token.isConst ? "const " : ""}${this.handleLanguageType(token.valueType)} ${token.identifier}${token.value !== "" ? ` = ${token.value}` : ""}`);
  }

  private static buildVariableItem(token: VariableDeclaration) {
    return this.buildMarkdown(`${this.handleLanguageType(token.valueType)} ${token.identifier}`);
  }

  private static buildFunctionParamItem(token: ParameterDeclaration) {
    return this.buildMarkdown(`${this.handleLanguageType(token.valueType)} ${token.identifier}`);
  }

  private static buildFunctionItem(token: FunctionDeclaration, serverConfig: ServerConfiguration) {
    return this.buildMarkdown(
      [`${this.handleLanguageType(token.returnType)} ${token.identifier}(${token.params.map((param) => this.formatParameter(param)).join(", ")})`],
      serverConfig.hovering.addCommentsToFunctions ? ["```nwscript", ...token.comments, "```"] : [],
      [],
    );
  }

  private static buildStructPropertyItem(property: FieldDeclaration) {
    return this.buildMarkdown(`${this.handleLanguageType(property.valueType)} ${property.identifier}`);
  }

  private static buildStructItem(token: StructDeclaration) {
    return this.buildMarkdown([`struct ${token.identifier}`, "{", ...token.properties.map((property) => `\t${property.valueType} ${property.identifier}`), "}"]);
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
