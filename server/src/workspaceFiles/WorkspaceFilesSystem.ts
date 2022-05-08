import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { basename } from "path";

import { FILES_EXTENSION } from ".";

export default class WorkspaceFilesSystem {
  static fileUriToPath = (uri: string) => {
    return fileURLToPath(uri);
  };

  static readFile = (filePath: string) => {
    return readFileSync(filePath).toString();
  };

  static getFileIncludes = (fileContent: string) => {
    return fileContent.match(/#include (["'])(?:(?=(\\?))\2.)*?\1/gm)?.map((include) => include.split(" ")[1].slice(1, -1)) || [];
  };

  static getFileBasename = (filePath: string) => {
    return basename(filePath, FILES_EXTENSION);
  };
}
