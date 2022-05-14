import { CompletionItem, CompletionItemKind } from "vscode-languageserver";
import { Position } from "vscode-languageserver-textdocument";
import { join } from "path";

import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { ServerManager } from "../ServerManager";

import Provider from "./Provider";
import { ComplexToken, StructComplexToken } from "../tokenizer/types";
import { CompletionItemBuilder } from "./Builders/CompletionItemBuilder";
import { TokenizedScope } from "../tokenizer/Tokenizer";

export default class CompletionItemsProvider extends Provider {
  private readonly standardLibDefinitions: ComplexToken[] = [];

  constructor(server: ServerManager) {
    super(server);

    this.standardLibDefinitions = JSON.parse(
      WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "..", "resources", "standardLibDefinitions.json")).toString()
    ).items as ComplexToken[];

    this.server.connection.onCompletion((params) => {
      const liveDocument = this.server.liveDocumentsManager.get(params.textDocument.uri);
      const path = WorkspaceFilesSystem.fileUriToPath(params.textDocument.uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);

      if (liveDocument) {
        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local);
        // if (params.context?.triggerCharacter === TriggerCharacters.dot) {
        //   return this.getStructureProperties(params.textDocument.uri, params.position);
        // }

        if (localScope?.structTypeLineCandidates.includes(params.position.line)) {
          return this.getStructTypes(documentKey);
        }
      }

      return this.standardLibDefinitions
        .concat(this.getGlobalComplexTokens(documentKey))
        .map((token) => CompletionItemBuilder.buildItem(token));
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

  private getStructureProperties(uri: string, position: Position) {
    const path = WorkspaceFilesSystem.fileUriToPath(uri);
    const documentKey = WorkspaceFilesSystem.getFileBasename(path);
    const document = this.server.documentsCollection?.get(documentKey);
    const liveDocument = this.server.liveDocumentsManager.get(uri);

    // if (document && liveDocument) {
    //   const structType = this.server.tokenizer?.retrieveStructType(liveDocument.getText(), position);
    //   const structureCandidates = this.getStructures(documentKey);
    //   const properties = structureCandidates.find((struct) => struct.data.identifier === structType)?.data.properties || [];
    //   return properties.map((property) => CompletionItemBuilder.buildItem(property));
    // }

    return [];
  }

  private getStructTypes(documentKey: string) {
    return this.getGlobalStructComplexTokens(documentKey).map((token) => CompletionItemBuilder.buildStructTypeItem(token));
  }
}
