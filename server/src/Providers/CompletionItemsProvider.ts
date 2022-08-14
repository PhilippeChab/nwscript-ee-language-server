import { CompletionParams } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
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
    this.server.connection.onCompletionResolve((item) =>
      this.exceptionsWrapper(() => CompletionItemBuilder.buildResolvedItem(item, this.server.config), item),
    );
  }

  private providerHandler(params: CompletionParams) {
    return () => {
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
              const structVariableIdentifier = this.server.tokenizer?.findLineIdentiferFromPositionAt(
                liveDocument.getText(),
                position,
                -2,
              );

              const structIdentifer = localScope.functionVariablesComplexTokens.find(
                (token) => token.identifier === structVariableIdentifier,
              )?.valueType;

              return document
                .getGlobalStructComplexTokens()
                .find((token) => token.identifier === structIdentifer)
                ?.properties.map((property) => {
                  return CompletionItemBuilder.buildItem(property);
                });
            }

            if (
              this.server.tokenizer?.findLineIdentiferFromPositionAt(liveDocument.getText(), position, -3) ===
              LanguageTypes.struct
            ) {
              return document.getGlobalStructComplexTokens().map((token) => CompletionItemBuilder.buildItem(token));
            }
          }

          return this.getLocalScopeCompletionItems(localScope)
            .concat(this.getGlobalScopeCompletionItems(document))
            .concat(this.getStandardLibCompletionItems());
        }
      }
    };
  }

  private getLocalScopeCompletionItems(localScope: LocalScopeTokenizationResult) {
    const functionVariablesCompletionItems = localScope.functionVariablesComplexTokens.map((token) =>
      CompletionItemBuilder.buildItem(token),
    );
    const functionsCompletionItems = localScope.functionsComplexTokens.map((token) => CompletionItemBuilder.buildItem(token));

    return functionVariablesCompletionItems.concat(functionsCompletionItems);
  }

  private getGlobalScopeCompletionItems(document: Document | undefined) {
    return document?.getGlobalComplexTokens().map((token) => CompletionItemBuilder.buildItem(token)) || [];
  }

  private getStandardLibCompletionItems() {
    return this.getStandardLibComplexTokens().map((token) => CompletionItemBuilder.buildItem(token));
  }
}
