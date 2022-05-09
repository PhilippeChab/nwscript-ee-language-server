import { readFileSync, readFile } from "fs";
import { fileURLToPath } from "url";
import { basename } from "path";

import { FILES_EXTENSION } from ".";

export default class WorkspaceFilesSystem {
  static fileUriToPath = (uri: string) => {
    return fileURLToPath(uri);
  };

  static readFileSync = (filePath: string) => {
    return readFileSync(filePath);
  };

  static readFileAsync = async (path: string) => {
    return new Promise((resolve, reject) => {
      readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
    });
  };

  static getFileIncludes = (fileContent: string) => {
    return fileContent.match(/#include (["'])(?:(?=(\\?))\2.)*?\1/gm)?.map((include) => include.split(" ")[1].slice(1, -1)) || [];
  };

  static getFileBasename = (filePath: string) => {
    return basename(filePath, FILES_EXTENSION);
  };
}
