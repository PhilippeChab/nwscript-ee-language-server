/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

import { fileURLToPath } from "url";
import { Range, TextDocument, TextEdit } from "vscode-languageserver-textdocument";

import { WorkspaceFilesSystem } from "../../WorkspaceFilesSystem";
import { Logger } from "../../Logger";

export default abstract class Formatter {
  constructor(
    protected readonly workspaceFilesSystem: WorkspaceFilesSystem,
    protected readonly enabled: boolean,
    protected readonly verbose: boolean,
    protected readonly ignoredGlobs: string[],
    protected readonly executable: string,
    protected readonly style: { [index: string]: any },
    protected readonly logger: Logger,
  ) {}

  protected isIgnoredFile(documentUri: string) {
    const documentPath = fileURLToPath(documentUri);

    return this.ignoredGlobs.some((glob) => {
      return this.workspaceFilesSystem.getGlobPaths(glob).some((path) => path === documentPath);
    });
  }

  protected abstract formatDocument(document: TextDocument, range: Range | null): Promise<TextEdit[] | null>;
}
