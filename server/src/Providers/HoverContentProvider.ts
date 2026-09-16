import type { ServerManager } from "../ServerManager";
import { HoverContentBuilder } from "./Builders";
import Provider from "./Provider";

export default class HoverContentProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);
    this.server.connection.onHover(({ textDocument: { uri }, position }) =>
      this.exceptionsWrapper(() => {
        const resolved = this.resolveSymbol(uri, position);
        if (resolved) return { contents: HoverContentBuilder.buildItem(resolved.declaration, this.server.config, this.server.capabilitiesHandler.getSupportsMarkdownHover()) };
      }),
    );
  }
}
