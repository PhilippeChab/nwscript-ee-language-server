import type { ServerManager } from "../ServerManager";
import Provider from "./Provider";

export default class GotoDefinitionProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);
    this.server.connection.onDefinition(({ textDocument: { uri }, position }) =>
      this.exceptionsWrapper(() => {
        const resolved = this.resolveSymbol(uri, position);
        if (!resolved?.owner) return;
        const target = resolved.token.position;
        return { uri: resolved.owner, range: { start: target, end: target } };
      }),
    );
  }
}
