import { CompletionItem, CompletionItemKind, TextEdit } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { ComplexToken, ConstantComplexToken, FunctionComplexToken, FunctionParamComplexToken, StructComplexToken, StructPropertyComplexToken, VariableComplexToken } from "../../Tokenizer/types";
import { ServerConfiguration } from "../../ServerManager/Config";
import type { AutoImportContext } from "../../Tokenizer/Tokenizer";
import Builder from "./Builder";

export default class CompletionItemBuilder extends Builder {
  public static buildAutoImportItem(token: ComplexToken, includeName: string, document: TextDocument, context: AutoImportContext, serverConfig: ServerConfiguration): CompletionItem {
    const item = this.buildItem(token);
    const insertionText = this.buildResolvedItem(item, serverConfig).label;
    const { insertionPosition, replacementRange } = context;
    const eol = document.getText().includes("\r\n") ? "\r\n" : "\n";
    const includeText = `${insertionPosition.character > 0 ? eol : ""}#include "${includeName}"${eol}`;
    const samePosition = insertionPosition.line === replacementRange.start.line && insertionPosition.character === replacementRange.start.character;

    return {
      ...item,
      detail: `${item.detail || token.identifier} — #include "${includeName}"`,
      filterText: token.identifier,
      // At the start of a file the include and identifier share an edit position.
      // Combine them so additionalTextEdits never overlap the completion edit.
      textEdit: TextEdit.replace(replacementRange, `${samePosition ? includeText : ""}${insertionText}`),
      additionalTextEdits: samePosition ? undefined : [TextEdit.insert(insertionPosition, includeText)],
    };
  }

  public static buildResolvedItem(item: CompletionItem, serverConfig: ServerConfiguration): CompletionItem {
    if (serverConfig.completion.addParamsToFunctions && item.kind === CompletionItemKind.Function) {
      const params = item.data as FunctionParamComplexToken[];

      return {
        ...item,
        label: `${item.label}(${params.reduce((acc, param, index) => {
          return `${acc}${this.handleLanguageType(param.valueType)} ${param.identifier}${index === params.length - 1 ? "" : ", "}`;
        }, "")})`,
      };
    }

    return item;
  }

  public static buildItem(token: ComplexToken, implicitConstants = false): CompletionItem {
    if (this.isConstantToken(token)) {
      return token.isConst || implicitConstants ? this.buildConstantItem(token) : this.buildVariableItem({ ...token, tokenType: CompletionItemKind.Variable });
    } else if (this.isVariableToken(token)) {
      return this.buildVariableItem(token);
    } else if (this.isFunctionParameterToken(token)) {
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
        return `${acc}${param.identifier}: ${this.handleLanguageType(param.valueType)}${index === token.params.length - 1 ? "" : ", "}`;
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
