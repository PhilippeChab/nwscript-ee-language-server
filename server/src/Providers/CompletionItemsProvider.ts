import { CompletionItem, CompletionItemKind, CompletionParams } from "vscode-languageserver";
import { Position } from "vscode-languageserver-textdocument";
import { join } from "path";

import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { ServerManager } from "../ServerManager";

import Provider from "./Provider";
import { ComplexToken, StructComplexToken } from "../Tokenizer/types";
import { CompletionItemBuilder } from "./Builders/CompletionItemBuilder";
import { LocalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { TriggerCharacters } from ".";

export default class CompletionItemsProvider extends Provider {
  private readonly standardLibDefinitions: ComplexToken[] = [];

  constructor(server: ServerManager) {
    super(server);

    this.standardLibDefinitions = JSON.parse(
      WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "..", "resources", "standardLibDefinitions.json")).toString()
    ).items as ComplexToken[];

    this.server.connection.onCompletion((params) => {
      const {
        textDocument: { uri },
        position: { line },
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const path = WorkspaceFilesSystem.fileUriToPath(uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);

      if (liveDocument) {
        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, line);

        if (localScope) {
          return this.getLocalScopeCompletionItems(params, documentKey, localScope);
        }
      }

      return this.getGlobalScopeCompletionItems(documentKey);
    });

    this.server.connection.onCompletionResolve((item: CompletionItem) => {
      return item;
    });
  }

  private getGlobalComplexTokens(documentKey: string, computedChildren: string[] = []): ComplexToken[] {
    const document = this.server.documentsCollection?.get(documentKey);

    if (document) {
      return document.complexTokens.concat(
        document.children.flatMap((child) => {
          // Cycling children or/and duplicates
          if (computedChildren.includes(child)) {
            return [];
          } else {
            computedChildren.push(child);
          }

          return this.getGlobalComplexTokens(child, computedChildren);
        })
      );
    }

    return [];
  }

  private getGlobalStructComplexTokens(documentKey: string, computedChildren: string[] = []): StructComplexToken[] {
    const document = this.server.documentsCollection?.get(documentKey);

    if (document) {
      return document.structComplexTokens.concat(
        document.children.flatMap((child) => {
          // Cycling children or/and duplicates
          if (computedChildren.includes(child)) {
            return [];
          } else {
            computedChildren.push(child);
          }

          return this.getGlobalStructComplexTokens(child, computedChildren);
        })
      );
    }

    return [];
  }

  private getGlobalScopeCompletionItems(documentKey: string) {
    return this.standardLibDefinitions
      .concat(this.getGlobalComplexTokens(documentKey))
      .map((token) => CompletionItemBuilder.buildItem(token));
  }

  private getLocalScopeCompletionItems(params: CompletionParams, documentKey: string, localScope: LocalScopeTokenizationResult) {
    const {
      context,
      position: { line },
    } = params;

    if (context?.triggerCharacter === TriggerCharacters.dot) {
      const structIdentifer = localScope.functionVariablesComplexTokens.find(
        (token) => token.data.identifier === localScope.structPropertiesCandidate
      )?.data.valueType;

      return this.getGlobalStructComplexTokens(documentKey)
        .find((token) => token.data.identifier === structIdentifer)
        ?.data.properties.map((property) => {
          return CompletionItemBuilder.buildStructPropertyItem(property);
        });
    }

    if (localScope.structIdentifiersLineCandidate === line) {
      return this.getGlobalStructComplexTokens(documentKey).map((token) =>
        CompletionItemBuilder.buildStructIdentifierItem(token)
      );
    }

    const functionVariablesCompletionItems = localScope.functionVariablesComplexTokens.map((token) =>
      CompletionItemBuilder.buildItem(token)
    );
    const functionsCompletionItems = localScope.functionsComplexTokens.map((token) => CompletionItemBuilder.buildItem(token));
    return functionVariablesCompletionItems
      .concat(functionsCompletionItems)
      .concat(this.getGlobalScopeCompletionItems(documentKey));
  }
}
