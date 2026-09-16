import { MarkupContent, MarkupKind } from "vscode-languageserver";

import type { Declaration, ConstantDeclaration, FunctionDeclaration, ParameterDeclaration, StructDeclaration, FieldDeclaration, VariableDeclaration } from "../../Parser/types";
import { ServerConfiguration } from "../../ServerManager/Config";
import Builder from "./Builder";

export default class HoverContentBuilder extends Builder {
  public static buildItem(declaration: Declaration, serverConfig: ServerConfiguration, markdown = true): MarkupContent {
    const content = this.buildRichItem(declaration, serverConfig);
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

  private static buildRichItem(declaration: Declaration, serverConfig: ServerConfiguration): MarkupContent {
    if (this.isConstantDeclaration(declaration)) {
      return this.buildConstantItem(declaration);
    } else if (this.isVariableDeclaration(declaration)) {
      return this.buildVariableItem(declaration);
    } else if (this.isParameterDeclaration(declaration)) {
      return this.buildFunctionParamItem(declaration);
    } else if (this.isFunctionDeclaration(declaration)) {
      return this.buildFunctionItem(declaration, serverConfig);
    } else if (this.isFieldDeclaration(declaration)) {
      return this.buildStructPropertyItem(declaration);
    } else if (this.isStructDeclaration(declaration)) {
      return this.buildStructItem(declaration);
    } else {
      return this.buildMarkdown("");
    }
  }

  private static buildConstantItem(declaration: ConstantDeclaration) {
    return this.buildMarkdown(
      `${declaration.isConst ? "const " : ""}${this.handleLanguageType(declaration.valueType)} ${declaration.identifier}${declaration.value !== "" ? ` = ${declaration.value}` : ""}`,
    );
  }

  private static buildVariableItem(declaration: VariableDeclaration) {
    return this.buildMarkdown(
      `${this.handleLanguageType(declaration.valueType)} ${declaration.identifier}${declaration.value !== undefined && declaration.value !== "" ? ` = ${declaration.value}` : ""}`,
    );
  }

  private static buildFunctionParamItem(declaration: ParameterDeclaration) {
    return this.buildMarkdown(`${this.handleLanguageType(declaration.valueType)} ${declaration.identifier}`);
  }

  private static buildFunctionItem(declaration: FunctionDeclaration, serverConfig: ServerConfiguration) {
    return this.buildMarkdown(
      [`${this.handleLanguageType(declaration.returnType)} ${declaration.identifier}(${declaration.params.map((param) => this.formatParameter(param)).join(", ")})`],
      serverConfig.hovering.addCommentsToFunctions ? ["```nwscript", ...declaration.comments, "```"] : [],
      [],
    );
  }

  private static buildStructPropertyItem(property: FieldDeclaration) {
    return this.buildMarkdown(`${this.handleLanguageType(property.valueType)} ${property.identifier}`);
  }

  private static buildStructItem(declaration: StructDeclaration) {
    return this.buildMarkdown([`struct ${declaration.identifier}`, "{", ...declaration.properties.map((property) => `\t${property.valueType} ${property.identifier}`), "}"]);
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
