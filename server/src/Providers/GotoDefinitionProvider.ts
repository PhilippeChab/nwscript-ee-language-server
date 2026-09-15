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
          const ownerDocument = this.server.liveDocumentsManager.get(resolved.owner);
          if (ownerDocument) {
            const cursor = normalizeDocumentUri(uri) === normalizeDocumentUri(resolved.owner) ? position : undefined;
            target = this.server.tokenizer.getFunctionNavigationTarget(ownerDocument, resolved.token.identifier, cursor) || target;
          }
        }
        return { uri: resolved.owner, range: { start: target, end: target } };
      }),
    );
  }
}
