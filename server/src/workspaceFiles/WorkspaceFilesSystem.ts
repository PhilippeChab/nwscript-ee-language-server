import { readFileSync, readFile } from "fs";
import { fileURLToPath } from "url";
import { basename } from "path";

import { FILES_EXTENSION } from ".";

export default class WorkspaceFilesSystem {
  static fileUriToPath(uri: string) {
    return fileURLToPath(uri);
  }

  static readFileSync(filePath: string) {
    return readFileSync(filePath);
  }

  static async readFileAsync(path: string) {
    return new Promise((resolve, reject) => {
      readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
    });
  }

  static getFileBasename(filePath: string) {
    return basename(filePath, FILES_EXTENSION).slice(0, -1);
  }
}
