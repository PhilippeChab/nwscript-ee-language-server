import { CompletionItem, CompletionItemKind, TextEdit } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { Declaration, ConstantDeclaration, FunctionDeclaration, ParameterDeclaration, StructDeclaration, FieldDeclaration, VariableDeclaration } from "../../Parser/types";
import { ServerConfiguration } from "../../ServerManager/Config";
import type { AutoImportContext } from "../../Parser/ParserService";
import Builder from "./Builder";

export default class CompletionItemBuilder extends Builder {
  public static buildAutoImportItem(declaration: Declaration, includeName: string, document: TextDocument, context: AutoImportContext, serverConfig: ServerConfiguration): CompletionItem {
    const item = this.buildItem(declaration);
    const insertionText = this.buildResolvedItem(item, serverConfig).label;
    const { insertionPosition, replacementRange } = context;
    const eol = document.getText().includes("\r\n") ? "\r\n" : "\n";
    const includeText = `${insertionPosition.character > 0 ? eol : ""}#include "${includeName}"${eol}`;
    const samePosition = insertionPosition.line === replacementRange.start.line && insertionPosition.character === replacementRange.start.character;

    return {
      ...item,
      detail: `${item.detail || declaration.identifier} — #include "${includeName}"`,
      filterText: declaration.identifier,
      // At the start of a file the include and identifier share an edit position.
      // Combine them so additionalTextEdits never overlap the completion edit.
      textEdit: TextEdit.replace(replacementRange, `${samePosition ? includeText : ""}${insertionText}`),
      additionalTextEdits: samePosition ? undefined : [TextEdit.insert(insertionPosition, includeText)],
    };
  }

  public static buildResolvedItem(item: CompletionItem, serverConfig: ServerConfiguration): CompletionItem {
    if (serverConfig.completion.addParamsToFunctions && item.kind === CompletionItemKind.Function && !item.label.includes("(")) {
      const params = item.data as ParameterDeclaration[];

      return {
        ...item,
        label: `${item.label}(${params.reduce((acc, param, index) => {
          return `${acc}${this.handleLanguageType(param.valueType)} ${param.identifier}${index === params.length - 1 ? "" : ", "}`;
        }, "")})`,
      };
    }

    return item;
  }

  public static buildItem(declaration: Declaration): CompletionItem {
    if (this.isConstantDeclaration(declaration)) {
      return this.buildConstantItem(declaration);
    } else if (this.isVariableDeclaration(declaration)) {
      return this.buildVariableItem(declaration);
    } else if (this.isParameterDeclaration(declaration)) {
      return this.buildFunctionParamItem(declaration);
    } else if (this.isFunctionDeclaration(declaration)) {
      return this.buildFunctionItem(declaration);
    } else if (this.isFieldDeclaration(declaration)) {
      return this.buildStructPropertyItem(declaration);
    } else if (this.isStructDeclaration(declaration)) {
      return this.buildStructItem(declaration);
    } else {
      return {
        label: "",
      };
    }
  }

  private static buildConstantItem(declaration: ConstantDeclaration): CompletionItem {
    return {
      label: declaration.identifier,
      kind: CompletionItemKind.Constant,
      detail: `(constant) ${declaration.value}: ${this.handleLanguageType(declaration.valueType)}`,
    };
  }

  private static buildVariableItem(declaration: VariableDeclaration): CompletionItem {
    return {
      label: declaration.identifier,
      kind: CompletionItemKind.Variable,
      detail: `(variable) ${declaration.identifier}: ${this.handleLanguageType(declaration.valueType)}`,
    };
  }

  private static buildFunctionParamItem(declaration: ParameterDeclaration): CompletionItem {
    return {
      label: declaration.identifier,
      kind: CompletionItemKind.Variable,
      detail: `(param) ${declaration.identifier}: ${this.handleLanguageType(declaration.valueType)}`,
    };
  }

  private static buildFunctionItem(declaration: FunctionDeclaration): CompletionItem {
    return {
      label: declaration.identifier,
      kind: CompletionItemKind.Function,
      detail: `(method) (${declaration.params.reduce((acc, param, index) => {
        return `${acc}${param.identifier}: ${this.handleLanguageType(param.valueType)}${index === declaration.params.length - 1 ? "" : ", "}`;
      }, "")}): ${this.handleLanguageType(declaration.returnType)}`,
      data: declaration.params,
    };
  }

  private static buildStructPropertyItem(property: FieldDeclaration): CompletionItem {
    return {
      label: property.identifier,
      kind: CompletionItemKind.Property,
      detail: `(property) ${property.identifier}: ${this.handleLanguageType(property.valueType)}`,
    };
  }

  private static buildStructItem(declaration: StructDeclaration): CompletionItem {
    return {
      label: declaration.identifier,
      kind: CompletionItemKind.Struct,
      detail: `(struct) ${declaration.identifier}`,
    };
  }
}
