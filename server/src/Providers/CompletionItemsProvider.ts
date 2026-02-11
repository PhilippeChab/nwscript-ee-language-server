import { CompletionItem, CompletionParams, TextEdit } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { CompletionItemBuilder } from "./Builders";
import { LocalScopeTokenizationResult } from "../Tokenizer/Tokenizer";
import { TriggerCharacters } from ".";
import { Document } from "../Documents";
import { LanguageTypes } from "../Tokenizer/constants";
import { computeIncludeInsertPosition } from "../Utils/includeInsertPosition";
import Provider from "./Provider";

export default class CompletionItemsProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onCompletion((params) => this.exceptionsWrapper(this.providerHandler(params)));
    this.server.connection.onCompletionResolve((item) =>
      this.exceptionsWrapper(() => {
        const resolved = CompletionItemBuilder.buildResolvedItem(item, this.server.config);

        if (item.data?.autoImport) {
          const { sourceFileKey, requestingUri } = item.data.autoImport;
          const liveDocument = this.server.liveDocumentsManager.get(requestingUri);
          if (liveDocument) {
            const insertPosition = computeIncludeInsertPosition(liveDocument.getText());
            resolved.additionalTextEdits = [TextEdit.insert(insertPosition, `#include "${sourceFileKey}"\n`)];
            resolved.command = { title: "Recompile", command: "nwscript-ee-lsp.recompile", arguments: [requestingUri] };
          }
        }

        return resolved;
      }, item),
    );
  }

  private providerHandler(params: CompletionParams) {
    return () => {
      const {
        textDocument: { uri },
        position,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const document = this.server.documentsCollection.getFromUri(uri);
      if (!liveDocument || !document) return;

      const [lines, rawTokenizedContent] = this.server.tokenizer.tokenizeContentToRaw(liveDocument.getText());
      const localScope = this.server.tokenizer.tokenizeContentFromRaw(lines, rawTokenizedContent, 0, position.line);

      if (params.context?.triggerCharacter === TriggerCharacters.dot) {
        const { rawContent } = this.server.tokenizer.getActionTargetAtPosition(lines, rawTokenizedContent, position, -1);
        const structIdentifer = localScope.functionVariablesComplexTokens.find((token) => token.identifier === rawContent)?.valueType;

        return document
          .getGlobalStructComplexTokens()
          .find((token) => token.identifier === structIdentifer)
          ?.properties.map((property) => {
            return CompletionItemBuilder.buildItem(property);
          });
      }

      if (this.server.tokenizer.getActionTargetAtPosition(lines, rawTokenizedContent, position, -2).rawContent === LanguageTypes.struct) {
        return document.getGlobalStructComplexTokens().map((token) => CompletionItemBuilder.buildItem(token));
      }

      return this.getGlobalScopeCompletionItems(document, localScope)
        .concat(this.getLocalScopeCompletionItems(localScope))
        .concat(this.getStandardLibCompletionItems())
        .concat(this.getAutoImportCompletionItems(document, localScope, uri));
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

  private getStandardLibCompletionItems() {
    return this.getStandardLibComplexTokens().map((token) => CompletionItemBuilder.buildItem(token));
  }

  private getAutoImportCompletionItems(document: Document, localScope: LocalScopeTokenizationResult, uri: string) {
    const children = document.getChildren();
    const ownKey = document.getKey();
    const excludedKeys = new Set([ownKey, ...children]);

    const inScopeIdentifiers = new Set<string>();
    document
      .getGlobalComplexTokens(
        [],
        localScope.functionsComplexTokens.map((t) => t.identifier),
      )
      .forEach((t) => inScopeIdentifiers.add(t.identifier));
    localScope.functionsComplexTokens.forEach((t) => inScopeIdentifiers.add(t.identifier));
    localScope.functionVariablesComplexTokens.forEach((t) => inScopeIdentifiers.add(t.identifier));
    this.getStandardLibComplexTokens().forEach((t) => inScopeIdentifiers.add(t.identifier));

    const isQueueSrc = uri.includes("queue_src");
    const items: CompletionItem[] = [];

    this.server.documentsCollection.forEach((doc) => {
      const docKey = doc.getKey();

      if (doc.base || excludedKeys.has(docKey)) return;

      const docIsQueueSrc = doc.uri.includes("queue_src");
      if (isQueueSrc !== docIsQueueSrc) return;

      const seenInDoc = new Set<string>();
      doc.complexTokens.forEach((token) => {
        if (!inScopeIdentifiers.has(token.identifier) && !seenInDoc.has(token.identifier)) {
          seenInDoc.add(token.identifier);
          items.push(CompletionItemBuilder.buildAutoImportItem(token, docKey, uri));
        }
      });
    });

    return items;
  }
}
