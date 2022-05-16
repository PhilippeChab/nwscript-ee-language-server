import type { CompletionItem } from "vscode-languageserver";
import { join } from "path";

import type { ServerManager } from "../ServerManager";
import type { ComplexToken } from "../Tokenizer/types";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { CompletionItemBuilder } from "./Builders/CompletionItemBuilder";
import { LocalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { TriggerCharacters } from ".";
import { Document } from "../Documents";
import Provider from "./Provider";

export default class CompletionItemsProvider extends Provider {
  private readonly standardLibDefinitions: ComplexToken[] = [];

  constructor(server: ServerManager) {
    super(server);

    this.standardLibDefinitions = JSON.parse(
      WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "..", "resources", "standardLibDefinitions.json")).toString()
    ).complexTokens as ComplexToken[];

    this.server.connection.onCompletion((params) => {
      const {
        textDocument: { uri },
        position: { line },
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const path = WorkspaceFilesSystem.fileUriToPath(uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);
      const document = this.server.documentsCollection?.get(documentKey);

      if (liveDocument) {
        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, line);

        if (localScope) {
          if (document) {
            if (params.context?.triggerCharacter === TriggerCharacters.dot) {
              const structIdentifer = localScope.functionVariablesComplexTokens.find(
                (token) => token.data.identifier === localScope.structPropertiesCandidate
              )?.data.valueType;

              return document
                .getGlobalStructComplexTokens()
                .find((token) => token.data.identifier === structIdentifer)
                ?.data.properties.map((property) => {
                  return CompletionItemBuilder.buildStructPropertyItem(property);
                });
            }

            if (localScope.structIdentifiersLineCandidate === line) {
              return document
                .getGlobalStructComplexTokens()
                .map((token) => CompletionItemBuilder.buildStructIdentifierItem(token));
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
    if (!document) {
      return [];
    }

    return this.standardLibDefinitions
      .concat(document.getGlobalComplexTokens())
      .map((token) => CompletionItemBuilder.buildItem(token));
  }
}
