import type { CompletionItem } from "vscode-languageserver";
import { join } from "path";

import type { ServerManager } from "../ServerManager";
import type { ComplexToken } from "../Tokenizer/types";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { CompletionItemBuilder } from "./Builders";
import { LocalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { TriggerCharacters } from ".";
import { Document } from "../Documents";
import Provider from "./Provider";
import { LanguageTypes } from "../Tokenizer/constants";

export default class CompletionItemsProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onCompletion((params) => {
      const {
        textDocument: { uri },
        position,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const path = WorkspaceFilesSystem.fileUriToPath(uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);
      const document = this.server.documentsCollection?.get(documentKey);

      if (liveDocument) {
        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, position.line);

        if (localScope) {
          if (document) {
            if (params.context?.triggerCharacter === TriggerCharacters.dot) {
              const structVariableIdentifier = this.server.tokenizer?.findLineIdentiferAt(liveDocument.getText(), position, -2);

              const structIdentifer = localScope.functionVariablesComplexTokens.find(
                (token) => token.identifier === structVariableIdentifier
              )?.valueType;

              return document
                .getGlobalStructComplexTokens()
                .find((token) => token.identifier === structIdentifer)
                ?.properties.map((property) => {
                  return CompletionItemBuilder.buildItem(property);
                });
            }

            if (this.server.tokenizer?.findLineIdentiferAt(liveDocument.getText(), position, -3) === LanguageTypes.struct) {
              return document.getGlobalStructComplexTokens().map((token) => CompletionItemBuilder.buildItem(token));
            }
          }

          return this.getLocalScopeCompletionItems(localScope).concat(this.getGlobalScopeCompletionItems(document));
        }
      }
    });

    this.server.connection.onCompletionResolve((item: CompletionItem) => {
      return item;
    });
  }

  private getLocalScopeCompletionItems(localScope: LocalScopeTokenizationResult) {
    const functionVariablesCompletionItems = localScope.functionVariablesComplexTokens.map((token) =>
      CompletionItemBuilder.buildItem(token)
    );
    const functionsCompletionItems = localScope.functionsComplexTokens.map((token) => CompletionItemBuilder.buildItem(token));

    return functionVariablesCompletionItems.concat(functionsCompletionItems);
  }

  private getGlobalScopeCompletionItems(document: Document | undefined) {
    if (document) {
      return this.getStandardLibComplexTokens()
        .concat(document.getGlobalComplexTokens())
        .map((token) => CompletionItemBuilder.buildItem(token));
    }

    return [];
  }

  private getStandardLibComplexTokens() {
    const documentCollection = this.server.documentsCollection;

    if (documentCollection) {
      return documentCollection.standardLibComplexTokens;
    }

    return [];
  }
}
