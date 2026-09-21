import type { ServerManager } from "../ServerManager";
import Provider from "./Provider";

export default class GotoDefinitionProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);
    this.server.connection.onDefinition(({ textDocument: { uri }, position }) =>
      this.exceptionsWrapper(() => {
        const target = this.getDocument(uri)?.semantic.getDefinitionAt(position);
        if (target) return { uri: target.uri, range: { start: target.position, end: target.position } };
      }),
    );
  }
}
