import { fileURLToPath } from "url";

import { WorkspaceFilesSystem } from "../../WorkspaceFilesSystem";
import { Logger } from "../../Logger";

export default class Formatter {
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
}
