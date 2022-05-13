import { CompletionItem } from "vscode-languageserver";
import { join } from "path";

import { WorkspaceFilesSystem } from "../workspaceFiles";
import type { DocumentsCollection } from "../documents";

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
    return this.documentsCollection.get(documentKey).getGlobalDefinitions(computedChildren);
  }

  getLocalCompletionItems(uri: string) {
    const path = WorkspaceFilesSystem.fileUriToPath(uri);
  }
}
