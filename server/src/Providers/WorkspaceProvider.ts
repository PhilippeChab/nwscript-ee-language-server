import type { ServerManager } from "../ServerManager";
import Provider from "./Provider";

export default class WorkspaceProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.workspace.onDidChangeWorkspaceFolders(() => {});
    this.server.connection.onDidChangeWatchedFiles(() => {});
  }
}
