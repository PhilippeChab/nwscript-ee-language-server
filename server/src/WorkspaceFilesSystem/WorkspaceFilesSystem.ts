import { basename, join, normalize, relative, isAbsolute, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { globSync } from "glob";
import { WorkspaceFolder } from "vscode-languageserver";

export const FILES_EXTENSION = ".nss";
export const resourceName = (path: string) =>
  basename(path)
    .replace(/\.nss$/i, "")
    .toLowerCase();

export default class WorkspaceFilesSystem {
  constructor(
    private readonly rootPath: string | null,
    private workspaceFolders: WorkspaceFolder[] | null,
  ) {}

  public setWorkspaceFolders(folders: WorkspaceFolder[]) {
    this.workspaceFolders = folders;
  }

  public getWorkspaceFolders() {
    return this.workspaceFolders ?? (this.rootPath ? [{ name: basename(this.rootPath), uri: pathToFileURL(this.rootPath).href }] : []);
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
    const files = globSync("**/nwscript.nss", { cwd: root, nocase: true, nodir: true }).filter((file) => this.getRootForUri(pathToFileURL(join(root, file)).href) === root);
    files.sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length || (a < b ? -1 : a > b ? 1 : 0));
    return files.length ? join(root, files[0]) : null;
  }

  public getFilesPath() {
    return this.getRoots().flatMap((root) =>
      globSync(`**/*${FILES_EXTENSION}`, { cwd: root, nodir: true, nocase: true })
        .sort((a, b) => a.localeCompare(b, "en"))
        .map((filename) => join(root, filename)),
    );
  }

  public getFilePath(filename: string) {
    // Match literal resource names, not glob expressions, across every root.
    return this.getFilesPath().find((path) => resourceName(path) === filename.toLowerCase()) || null;
  }

  public getGlobPaths(glob: string) {
    return globSync(glob, { cwd: this.getWorkspaceRootPath() })
      .sort((a, b) => a.localeCompare(b, "en"))
      .map((filename) => this.normalizedAbsolutePath(filename));
  }

  public getWorkspaceRootPath() {
    return this.getRoots()[0] || this.rootPath || process.cwd();
  }

  private normalizedAbsolutePath(...parts: string[]) {
    return normalize(join(this.getWorkspaceRootPath(), ...parts));
  }
}
