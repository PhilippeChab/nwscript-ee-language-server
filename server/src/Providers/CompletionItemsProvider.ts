import { CompletionParams } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { CompletionItemBuilder } from "./Builders";
import { LocalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
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

      return this.getGlobalScopeCompletionItems(document, localScope).concat(this.getLocalScopeCompletionItems(localScope)).concat(this.getStandardLibCompletionItems());
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
}
