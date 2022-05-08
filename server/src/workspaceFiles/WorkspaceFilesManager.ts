import { normalize, join } from "path";
import { GlobSync } from "glob";
import { FILES_EXTENSION } from ".";

export default class WorkspaceFilesManager {
  private readonly srcDirectoryPart = "src";

  constructor(private readonly rootPath: string) {}

  private normalizedAbsolutePath = (...parts: string[]) => {
    return normalize(join(this.rootPath, ...parts));
  };

  getAllFilePaths = () => {
    return new GlobSync(`src/**/*.${FILES_EXTENSION}`).found.map((filename) => this.normalizedAbsolutePath(filename));
  };
}
