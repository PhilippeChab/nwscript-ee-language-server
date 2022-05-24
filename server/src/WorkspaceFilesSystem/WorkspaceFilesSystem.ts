import { WorkspaceFolder } from "vscode-languageserver";
import { readFileSync, readFile, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { basename, join, normalize } from "path";
import { GlobSync } from "glob";

export const FILES_EXTENSION = "nss";

export default class WorkspaceFilesSystem {
  constructor(private readonly rootPath: string, private readonly workspaceFolders: WorkspaceFolder[]) {}

  private normalizedAbsolutePath(...parts: string[]) {
    return normalize(join(this.rootPath, ...parts));
  }

  public getAllFilePaths() {
    return new GlobSync(`**/*.${FILES_EXTENSION}`).found.map((filename) => this.normalizedAbsolutePath(filename));
  }

  public getGlobFilePaths(glob: string) {
    return new GlobSync(glob).found.map((filename) => this.normalizedAbsolutePath(filename));
  }

  public getExecutablePath(executable: string) {
    return normalize(executable);
  }

  public getWorkspaceRootPath() {
    return this.rootPath;
  }

  public static fileUriToPath(uri: string) {
    return fileURLToPath(uri);
  }

  public static filePathToUri(path: string) {
    return pathToFileURL(path);
  }

  public static existsSync(path: string) {
    return existsSync(path);
  }

  public static readFileSync(filePath: string) {
    return readFileSync(filePath);
  }

  public static async readFileAsync(filePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      readFile(filePath, (error, data) => (error ? reject(error) : resolve(data)));
    });
  }

  public static getFileBasename(filePath: string) {
    return basename(filePath, FILES_EXTENSION).slice(0, -1);
  }
}
