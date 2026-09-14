import type { ServerManager } from "../ServerManager";
import Provider from "./Provider";
import { FileChangeType } from "vscode-languageserver";
import { isStandardLibrary } from "../Documents/StandardLibrary";

export default class WorkspaceProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    if (this.server.capabilitiesHandler.getSupportsWorkspaceFolders()) {
      this.server.connection.workspace.onDidChangeWorkspaceFolders(({ added, removed }) => {
        const folders = this.server.workspaceFilesSystem.getWorkspaceFolders().filter((folder) => !removed.some((item) => item.uri === folder.uri));
        this.server.workspaceFilesSystem.setWorkspaceFolders(folders.concat(added));
        this.server.refreshStandardLibrary();
      });
    }
    this.server.connection.onDidChangeWatchedFiles(({ changes }) => {
      for (const change of changes) {
        if (change.type === FileChangeType.Deleted) this.server.standardLibrary.close(change.uri);
      }
      if (changes.some((change) => isStandardLibrary(change.uri))) this.server.refreshStandardLibrary();
    });
  }
}
