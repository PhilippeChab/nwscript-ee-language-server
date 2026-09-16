import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind } from "vscode-languageserver";
import { normalizeDocumentUri } from "../Utils";
import type { ServerManager } from "../ServerManager";
import Provider from "./Provider";

export default class GotoDefinitionProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);
    this.server.connection.onDefinition(({ textDocument: { uri }, position }) =>
      this.exceptionsWrapper(() => {
        const resolved = this.resolveSymbol(uri, position);
        if (!resolved?.owner) return;
        let target = resolved.token.position;
        if (resolved.token.tokenType === CompletionItemKind.Function) {
          const ownerDocument = this.getSourceDocument(resolved.owner);
          if (ownerDocument) {
            const cursor = normalizeDocumentUri(uri) === normalizeDocumentUri(resolved.owner) ? position : undefined;
            target = this.server.parserService.parse(ownerDocument).getFunctionNavigationTarget(resolved.token.identifier, cursor) || target;
          }
        }
        return { uri: resolved.owner, range: { start: target, end: target } };
      }),
    );
  }

  private getSourceDocument(uri: string) {
    const live = this.server.liveDocumentsManager.get(uri);
    if (live) return live;
    try {
      return TextDocument.create(uri, "nwscript", 0, readFileSync(fileURLToPath(uri), "utf8"));
    } catch {
      // A file may disappear between indexing and navigation. Keep the indexed target.
      return undefined;
    }
  }
}
