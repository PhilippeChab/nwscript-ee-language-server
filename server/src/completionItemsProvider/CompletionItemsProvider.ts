import { WorkspaceFilesSystem } from "../workspaceFiles";

import type { DocumentsCollection } from "../documents";

export default class CompletionItemsProvider {
  constructor(private readonly documentsCollection: DocumentsCollection) {}

  getGlobalCompletionItemsFromUri = (uri: string) => {
    const path = WorkspaceFilesSystem.fileUriToPath(uri);
    const documentKey = WorkspaceFilesSystem.getFileBasename(path);

    return this.documentsCollection.get(documentKey).getGlobalDefinitions();
  };

  getGlobalCompletionItemsFromDocumentKey = (documentKey: string, computedChildren: string[]) => {
    return this.documentsCollection.get(documentKey).getGlobalDefinitions(computedChildren);
  };
}
