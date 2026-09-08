/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

import { join, normalize } from "path";
import { GlobSync } from "glob";
import { WorkspaceFolder } from "vscode-languageserver";

export const FILES_EXTENSION = ".nss";

export default class WorkspaceFilesSystem {
  constructor(private readonly rootPath: string, private readonly workspaceFolders: WorkspaceFolder[]) {}

  private normalizedAbsolutePath(...parts: string[]) {
    return normalize(join(this.rootPath, ...parts));
  }

  public getFilesPath() {
    return new GlobSync(`**/*${FILES_EXTENSION}`).found.map((filename) => this.normalizedAbsolutePath(filename));
  }

  public getFilePath(filename: string) {
    const path = new GlobSync(`**/${filename}${FILES_EXTENSION}`).found[0];
    if (path) {
      return this.normalizedAbsolutePath(path);
    }

    return null;
  }

  public getGlobPaths(glob: string) {
    return new GlobSync(glob).found.map((filename) => this.normalizedAbsolutePath(filename));
  }

  public getWorkspaceRootPath() {
    return this.rootPath;
  }
}
