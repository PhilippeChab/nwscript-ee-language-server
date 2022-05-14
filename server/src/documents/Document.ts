import type { CompletionItem } from "vscode-languageserver/node";

import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";

type Definitions = { globalItems: CompletionItem[]; localItems: CompletionItem[] };
export type Structure = { type: string; properties: Record<string, string> };

export default class Document {
  constructor(
    readonly path: string,
    readonly children: string[],
    readonly structures: Structure[],
    readonly definitions: Definitions
  ) {}

  public getKey() {
    return WorkspaceFilesSystem.getFileBasename(this.path);
  }
}
