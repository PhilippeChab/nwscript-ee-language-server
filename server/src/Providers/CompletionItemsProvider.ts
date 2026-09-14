import { CompletionItem, CompletionParams } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { ServerManager } from "../ServerManager";
import { CompletionItemBuilder } from "./Builders";
import { AutoImportContext, LocalScopeTokenizationResult } from "../Tokenizer/Tokenizer";
import { TriggerCharacters } from ".";
import { Document } from "../Documents";
import { LanguageTypes } from "../Tokenizer/constants";
import Provider from "./Provider";

export default class CompletionItemsProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onCompletion((params) => this.exceptionsWrapper(this.providerHandler(params)));
    this.server.connection.onCompletionResolve((item) => this.exceptionsWrapper(() => CompletionItemBuilder.buildResolvedItem(item, this.server.config), item));
  }

  private providerHandler(params: CompletionParams) {
    return () => {
      const {
        textDocument: { uri },
        position,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const indexedDocument = this.server.documentsCollection.getFromUri(uri);
      if (!liveDocument || !indexedDocument) return;

      const [lines, rawTokenizedContent] = this.server.tokenizer.tokenizeContentToRaw(liveDocument.getText());
      const document = indexedDocument.withChildren(this.server.tokenizer.getIncludesFromRaw(lines, rawTokenizedContent));
      const localScope = this.server.tokenizer.tokenizeContentFromRaw(lines, rawTokenizedContent, 0, position.line);
      const autoImportContext = this.server.config.completion.autoImport ? this.server.tokenizer.getAutoImportContextFromRaw(lines, rawTokenizedContent, position) : undefined;

      if (params.context?.triggerCharacter === TriggerCharacters.dot) {
        const { rawContent } = this.server.tokenizer.getActionTargetAtPosition(lines, rawTokenizedContent, position, -1);
        const structIdentifer = localScope.functionVariablesComplexTokens.find((token) => token.identifier === rawContent)?.valueType;

        return document
          .getGlobalStructComplexTokens()
          .concat(this.getStandardLibStructTokens(uri))
          .find((token) => token.identifier === structIdentifer)
          ?.properties.map((property) => {
            return CompletionItemBuilder.buildItem(property);
          });
      }

      if (autoImportContext?.structsOnly || this.server.tokenizer.getActionTargetAtPosition(lines, rawTokenizedContent, position, -2).rawContent === LanguageTypes.struct) {
        const items = document
          .getGlobalStructComplexTokens()
          .concat(this.getStandardLibStructTokens(uri))
          .map((token) => CompletionItemBuilder.buildItem(token));
        return items.concat(this.getAutoImportCompletionItems(document, liveDocument, autoImportContext, items));
      }

      const items = this.getGlobalScopeCompletionItems(document, localScope).concat(this.getLocalScopeCompletionItems(localScope)).concat(this.getStandardLibCompletionItems(uri));
      const seen = new Set<string>();
      const visible = items.filter((item) => {
        if (seen.has(item.label)) return false;
        seen.add(item.label);
        return true;
      });
      return visible.concat(this.getAutoImportCompletionItems(document, liveDocument, autoImportContext, visible));
    };
  }

  private getGlobalScopeCompletionItems(document: Document, localScope: LocalScopeTokenizationResult) {
    return document
      .getGlobalComplexTokens(
        [],
        localScope.functionsComplexTokens.map((token) => token.identifier),
      )
      .map((token) => CompletionItemBuilder.buildItem(token));
  }

  private getLocalScopeCompletionItems(localScope: LocalScopeTokenizationResult) {
    const functionVariablesCompletionItems = localScope.functionVariablesComplexTokens.map((token) => CompletionItemBuilder.buildItem(token));
    const functionsCompletionItems = localScope.functionsComplexTokens.map((token) => CompletionItemBuilder.buildItem(token));

    return functionVariablesCompletionItems.concat(functionsCompletionItems);
  }

  private getStandardLibCompletionItems(uri: string) {
    return this.getStandardLibComplexTokens(uri).map((token) => CompletionItemBuilder.buildItem(token));
  }

  private getAutoImportCompletionItems(document: Document, liveDocument: TextDocument, context: AutoImportContext | undefined, visible: CompletionItem[]) {
    if (!context) return [];
    const visibleNames = new Set(visible.map((item) => item.label));
    return this.server.documentsCollection.getImportableDocuments(document).flatMap((candidate) => {
      const includeName = candidate.getIncludeName();
      const tokens = context.structsOnly ? candidate.structComplexTokens : candidate.complexTokens;
      const seen = new Set<string>();
      return tokens
        .filter((token) => {
          if (visibleNames.has(token.identifier) || seen.has(token.identifier) || token.identifier === "main" || token.identifier === "StartingConditional") return false;
          seen.add(token.identifier);
          return true;
        })
        .map((token) => CompletionItemBuilder.buildAutoImportItem(token, includeName, liveDocument, context, this.server.config));
    });
  }
}
