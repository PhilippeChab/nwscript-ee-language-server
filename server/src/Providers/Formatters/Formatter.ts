import { WorkspaceFilesSystem } from "../../WorkspaceFilesSystem";
import { Logger } from "../../Logger";
import { delimiter, join } from "path";

const codeByteOffsetCache = { byte: 0, offset: 0 };
const binPathCache: { [bin: string]: string } = {};

const platformBinName = (binName: string) => {
  if (process.platform === "win32") {
    return [binName + ".exe", binName + ".bat", binName + ".cmd", binName];
  } else {
    return [binName];
  }
};

export default class Formatter {
  constructor(
    protected readonly workspaceFilesSystem: WorkspaceFilesSystem,
    protected readonly ignoredGlobs: string[],
    protected readonly executable: string,
    protected readonly style: { [index: string]: any },
    protected readonly logger: Logger
  ) {}

  protected byteToOffset(codeContent: string, editInfo: { length: number; offset: number }) {
    const codeBuffer = Buffer.from(codeContent);

    const offset = editInfo.offset;
    const length = editInfo.length;

    if (offset >= codeByteOffsetCache.byte) {
      editInfo.offset = codeByteOffsetCache.offset + codeBuffer.slice(codeByteOffsetCache.byte, offset).toString("utf8").length;
      codeByteOffsetCache.byte = offset;
      codeByteOffsetCache.offset = editInfo.offset;
    } else {
      editInfo.offset = codeBuffer.slice(0, offset).toString("utf8").length;
      codeByteOffsetCache.byte = offset;
      codeByteOffsetCache.offset = editInfo.offset;
    }

    editInfo.length = codeBuffer.slice(offset, offset + length).toString("utf8").length;

    return editInfo;
  }

  protected getExecutablePath() {
    const binName = this.executable;

    if (binPathCache[binName]) {
      return binPathCache[binName];
    }

    for (const binNameToSearch of platformBinName(binName)) {
      if (WorkspaceFilesSystem.existsSync(binNameToSearch)) {
        binPathCache[binName] = binNameToSearch;
        return binNameToSearch;
      }

      if (process.env["PATH"]) {
        const pathParts = process.env["PATH"].split(delimiter);

        for (let i = 0; i < pathParts.length; i++) {
          const binPath = join(pathParts[i], binNameToSearch);

          if (WorkspaceFilesSystem.existsSync(binPath)) {
            binPathCache[binName] = binPath;
            return binPath;
          }
        }
      }
    }

    binPathCache[binName] = binName;
    return binName;
  }

  public isIgnoredFile(documentUri: string) {
    const documentPath = WorkspaceFilesSystem.fileUriToPath(documentUri);

    return this.ignoredGlobs.some((glob) => {
      return this.workspaceFilesSystem.getGlobPaths(glob).some((path) => path === documentPath);
    });
  }
}
