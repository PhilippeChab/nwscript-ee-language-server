import { join, normalize } from "path";
import { GlobSync } from "glob";
import { WorkspaceFolder } from "vscode-languageserver";

export const FILES_EXTENSION = "nss";

export default class WorkspaceFilesSystem {
  constructor(private readonly rootPath: string, private readonly workspaceFolders: WorkspaceFolder[]) {}

  private normalizedAbsolutePath(...parts: string[]) {
    return normalize(join(this.rootPath, ...parts));
  }

  public getAllFilesPath() {
    return new GlobSync(`**/*.${FILES_EXTENSION}`).found.map((filename) => this.normalizedAbsolutePath(filename));
  }

  public getGlobPaths(glob: string) {
    return new GlobSync(glob).found.map((filename) => this.normalizedAbsolutePath(filename));
  }
}
