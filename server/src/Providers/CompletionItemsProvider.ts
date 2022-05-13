import { CompletionItem, CompletionItemKind } from "vscode-languageserver";
import { Position } from "vscode-languageserver-textdocument";
import { join } from "path";

import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { TriggerCharacters } from ".";
import { ServerManager } from "../ServerManager";

import Provider from "./Provider";
import { Structure } from "../Documents/Document";

export default class CompletionItemsProvider extends Provider {
  private readonly standardLibDefinitions: CompletionItem[] = [];

  constructor(server: ServerManager) {
    super(server);

    this.standardLibDefinitions = JSON.parse(
      WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "..", "resources", "standardLibDefinitions.json")).toString()
    ).items as CompletionItem[];

    this.server.connection.onCompletion((params) => {
      if (params.context?.triggerCharacter === TriggerCharacters.dot) {
        return this.getStructureProperties(params.textDocument.uri, params.position);
      }

      return this.getGlobalCompletionItemsFromUri(params.textDocument.uri);
    });

    this.server.connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
      return item;
    });
  }

  private getGlobalCompletionItemsFromUri(uri: string) {
    const path = WorkspaceFilesSystem.fileUriToPath(uri);
    const documentKey = WorkspaceFilesSystem.getFileBasename(path);
    const document = this.server.documentsCollection?.get(documentKey);

    if (!document) {
      return [];
    }

    return this.standardLibDefinitions.concat(
      document.definitions.globalItems.concat(
        document.children.flatMap((child) => {
          return this.getGlobalCompletionItemsFromDocumentKey(child);
        })
      )
    );
  }

  private getGlobalCompletionItemsFromDocumentKey(documentKey: string, computedChildren: string[] = []): CompletionItem[] {
    const document = this.server.documentsCollection?.get(documentKey);

    if (document) {
      return document.definitions.globalItems.concat(
        document.children.flatMap((child) => {
          // Cycling children or/and duplicates
          if (computedChildren.includes(child)) {
            return [];
          } else {
            computedChildren.push(child);
          }

          return this.getGlobalCompletionItemsFromDocumentKey(child, computedChildren);
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

    if (!document || !liveDocument) {
      return [];
    }

    const structLabel = this.server.tokenizer?.retrieveStructLabel(liveDocument.getText(), position);
    return Object.entries(
      document.structures
        .concat(document.children.flatMap((child) => this.getStructuresFromDocumentKey(child)))
        .find((structure) => structure.label === structLabel)?.properties || []
    ).map((property) => {
      return {
        label: property[0],
        kind: CompletionItemKind.Property,
        detail: `(property) ${property[1]} ${property[0]};`,
      };
    });
  }

  private getStructuresFromDocumentKey(documentKey: string, computedChildren: string[] = []): Structure[] {
    const document = this.server.documentsCollection?.get(documentKey);

    if (document) {
      return document.structures.concat(
        document.children.flatMap((child) => {
          // Cycling children or/and duplicates
          if (computedChildren.includes(child)) {
            return [];
          } else {
            computedChildren.push(child);
          }

          return this.getStructuresFromDocumentKey(child, computedChildren);
        })
      );
    }

    return [];
  }
}
