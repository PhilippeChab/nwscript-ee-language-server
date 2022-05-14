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
      const path = WorkspaceFilesSystem.fileUriToPath(params.textDocument.uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);
      if (params.context?.triggerCharacter === TriggerCharacters.dot) {
        return this.getStructureProperties(params.textDocument.uri, params.position);
      }

      if (this.isStructureCandidate(params.textDocument.uri, params.position)) {
        return this.getStructureTypes(documentKey);
      }

      return this.standardLibDefinitions.concat(this.getGlobalCompletionItems(documentKey));
    });

    this.server.connection.onCompletionResolve((item: CompletionItem) => {
      return item;
    });
  }

  private getGlobalCompletionItems(documentKey: string, computedChildren: string[] = []): CompletionItem[] {
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

          return this.getGlobalCompletionItems(child, computedChildren);
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

    if (document && liveDocument) {
      const structType = this.server.tokenizer?.retrieveStructType(liveDocument.getText(), position);
      const structureCandidates = this.getStructures(documentKey);
      const properties = structureCandidates.find((struct) => struct.type === structType)?.properties || {};
      return Object.entries(properties).map((property) => {
        return {
          label: property[0],
          kind: CompletionItemKind.Property,
          detail: `(property) ${property[1]} ${property[0]};`,
        };
      });
    }

    return [];
  }

  private getStructureTypes(documentKey: string) {
    return this.getStructures(documentKey).map((structure) => {
      return {
        label: structure.type,
        kind: CompletionItemKind.Struct,
        defail: `(struct) ${structure.type}`,
      };
    });
  }

  private getStructures(documentKey: string, computedChildren: string[] = []): Structure[] {
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

          return this.getStructures(child, computedChildren);
        })
      );
    }

    return [];
  }

  private isStructureCandidate(uri: string, position: Position) {
    const liveDocument = this.server.liveDocumentsManager.get(uri);

    if (liveDocument) {
      const content = liveDocument.getText();
      return this.server.tokenizer?.isStructureCandidate(content, position);
    }

    return false;
  }
}
