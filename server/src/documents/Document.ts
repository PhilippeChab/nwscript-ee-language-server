import { CompletionItem } from "vscode-languageserver/node";

import { documentsCollection } from "../server";
import { WorkspaceFilesSystem } from "../workspaceFiles";

export default class Document {
  readonly path: string;
  readonly children: string[];
  readonly definitions: CompletionItem[];

  constructor(path: string, children: string[], definitions: CompletionItem[]) {
    this.path = path;
    this.children = children;
    this.definitions = definitions;
  }

  getKey = () => {
    return WorkspaceFilesSystem.getFileBasename(this.path);
  };

  getDefinitions = (computedChildren: string[] = []): CompletionItem[] => {
    return this.definitions.concat(
      this.children.flatMap((child) => {
        // Cycling children or/and duplicates
        if (computedChildren.includes(child)) {
          return [];
        } else {
          return documentsCollection.get(child).getDefinitions(computedChildren.concat(this.children));
        }
      })
    );
  };
}
