import { CompletionItem, CompletionItemKind } from "vscode-languageserver";
import { join } from "path";

import { WorkspaceFilesSystem } from "../workspaceFiles";
import type { DocumentsCollection } from "../documents";
import { Position } from "vscode-languageserver-textdocument";
import { tokenizer } from "../server";

export default class CompletionItemsProvider {
  private readonly standardLibDefinitions: CompletionItem[] = [];

  constructor(private readonly documentsCollection: DocumentsCollection) {
    this.standardLibDefinitions = JSON.parse(
      WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "..", "resources", "standardLibDefinitions.json")).toString()
    ).items as CompletionItem[];
  }

  getGlobalCompletionItemsFromUri(uri: string) {
    const path = WorkspaceFilesSystem.fileUriToPath(uri);
    const documentKey = WorkspaceFilesSystem.getFileBasename(path);

    return this.standardLibDefinitions.concat(this.documentsCollection.get(documentKey).getGlobalDefinitions());
  }

  getGlobalCompletionItemsFromDocumentKey(documentKey: string, computedChildren: string[]) {
    const document = this.documentsCollection.get(documentKey);

    if (document) {
      return document.getGlobalDefinitions(computedChildren);
    }

    return [];
  }

  getStructureProperties(uri: string, position: Position) {
    const path = WorkspaceFilesSystem.fileUriToPath(uri);
    const documentKey = WorkspaceFilesSystem.getFileBasename(path);
    const content = WorkspaceFilesSystem.readFileSync(path).toString();

    const structLabel = tokenizer.retrieveStructLabel(content, position);
    return Object.entries(
      this.documentsCollection
        .get(documentKey)
        .getStructures()
        .find((structure) => structure.label === structLabel)?.properties || []
    ).map((property) => {
      return {
        label: property[0],
        kind: CompletionItemKind.Property,
        detail: `(property) ${property[1]} ${property[0]};`,
      };
    });
  }

  getStructuresFromDocumentKey(documentKey: string) {
    const document = this.documentsCollection.get(documentKey);

    if (document) {
      return document.getStructures();
    }

    return [];
  }

  getLocalCompletionItems(uri: string) {
    const path = WorkspaceFilesSystem.fileUriToPath(uri);
  }
}
