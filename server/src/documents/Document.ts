import { CompletionItem } from "vscode-languageserver/node";

import { completionItemsProvider } from "../server";
import { WorkspaceFilesSystem } from "../workspaceFiles";

type Definitions = { globalItems: CompletionItem[]; localItems: CompletionItem[] };
export type Structure = { name: string; properties: Record<string, string> };

export default class Document {
  constructor(
    readonly path: string,
    readonly children: string[],
    readonly structures: Structure[],
    readonly definitions: Definitions
  ) {}

  getKey() {
    return WorkspaceFilesSystem.getFileBasename(this.path);
  }

  getGlobalDefinitions(computedChildren: string[] = []): CompletionItem[] {
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
  }
}
