import { readFileSync, readFile } from "fs";
import { fileURLToPath } from "url";
import { basename, join, normalize } from "path";

import { GlobSync } from "glob";

const FILES_EXTENSION = "nss";
export default class WorkspaceFilesSystem {
  static fileUriToPath(uri: string) {
    return fileURLToPath(uri);
  }

  static readFileSync(filePath: string) {
    return readFileSync(filePath);
  }

  static async readFileAsync(filePath: string) {
    return new Promise((resolve, reject) => {
      readFile(filePath, (error, data) => (error ? reject(error) : resolve(data)));
    });
  }

  static getFileBasename(filePath: string) {
    return basename(filePath, FILES_EXTENSION).slice(0, -1);
  }

  constructor(private readonly rootPath: string) {}

  private normalizedAbsolutePath(...parts: string[]) {
    return normalize(join(this.rootPath, ...parts));
  }

  getAllFilePaths() {
    return new GlobSync(`src/**/*.${FILES_EXTENSION}`).found.map((filename) => this.normalizedAbsolutePath(filename));
  }
}
