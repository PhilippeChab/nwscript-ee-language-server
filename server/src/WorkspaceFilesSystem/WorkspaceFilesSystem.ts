import { join, normalize, relative, isAbsolute, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { GlobSync } from "glob";
import { WorkspaceFolder } from "vscode-languageserver";

export const FILES_EXTENSION = ".nss";

export default class WorkspaceFilesSystem {
  constructor(private readonly rootPath: string | null, private workspaceFolders: WorkspaceFolder[] | null) {}

  public setWorkspaceFolders(folders: WorkspaceFolder[]) {
    this.workspaceFolders = folders;
  }

  public getWorkspaceFolders() {
    return this.workspaceFolders || [];
  }

  public getRoots() {
    return this.workspaceFolders?.length ? this.workspaceFolders.map((folder) => fileURLToPath(folder.uri)) : this.workspaceFolders ? [] : this.rootPath ? [this.rootPath] : [];
  }

  public getRootForUri(uri: string) {
    const path = fileURLToPath(uri);
    return this.getRoots()
      .filter((root) => {
        const child = relative(root, path);
        return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
      })
      .sort((a, b) => b.length - a.length)[0];
  }

  public getStandardLibraryPath(uri: string) {
    const root = this.getRootForUri(uri);
    if (!root) return null;
    const files = new GlobSync("**/nwscript.nss", { cwd: root, nocase: true, nodir: true }).found.filter((file) => this.getRootForUri(pathToFileURL(join(root, file)).href) === root);
    files.sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length || (a < b ? -1 : a > b ? 1 : 0));
    return files.length ? join(root, files[0]) : null;
  }

  private normalizedAbsolutePath(...parts: string[]) {
    return normalize(join(this.getWorkspaceRootPath(), ...parts));
  }

  public getFilesPath() {
    return this.getRoots().flatMap((root) => new GlobSync(`**/*${FILES_EXTENSION}`, { cwd: root, nodir: true }).found.map((filename) => join(root, filename)));
  }

  public getFilePath(filename: string) {
    const path = new GlobSync(`**/${filename}${FILES_EXTENSION}`, { cwd: this.getWorkspaceRootPath(), nodir: true }).found[0];
    if (path) {
      return this.normalizedAbsolutePath(path);
    }

    return null;
  }

  public getGlobPaths(glob: string) {
    return new GlobSync(glob, { cwd: this.getWorkspaceRootPath() }).found.map((filename) => this.normalizedAbsolutePath(filename));
  }

  public getWorkspaceRootPath() {
    return this.getRoots()[0] || this.rootPath || process.cwd();
  }
}
