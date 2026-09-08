/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

import type { ServerManager } from "../ServerManager";
import Provider from "./Provider";

export default class WorkspaceProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.workspace.onDidChangeWorkspaceFolders(() => {});
    this.server.connection.onDidChangeWatchedFiles(() => {});
  }
}
