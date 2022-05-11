import { CompletionItem } from "vscode-languageserver/node";

import { completionItemsProvider } from "../server";
import { WorkspaceFilesSystem } from "../workspaceFiles";

type Definitions = { globalItems: CompletionItem[]; localItems: CompletionItem[] };
export default class Document {
  readonly path: string;
  readonly children: string[];
  readonly definitions: Definitions;

  constructor(path: string, children: string[], definitions: Definitions) {
    this.path = path;
    this.children = children;
    this.definitions = definitions;
  }

  getKey = () => {
    return WorkspaceFilesSystem.getFileBasename(this.path);
  };

  getGlobalDefinitions = (computedChildren: string[] = []): CompletionItem[] => {
    return this.definitions.globalItems.concat(
      this.children.flatMap((child) => {
        // Cycling children or/and duplicates
        if (computedChildren.includes(child)) {
          return [];
        } else {
          return completionItemsProvider.getGlobalCompletionItemsFromDocumentKey(child, computedChildren.concat(this.children));
        }
      })
    );
  };
}
