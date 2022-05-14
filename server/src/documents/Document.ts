import type { ComplexToken, StructComplexToken } from "../tokenizer/types";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";

export default class Document {
  constructor(
    readonly path: string,
    readonly children: string[],
    readonly complexTokens: ComplexToken[],
    readonly structComplexTokens: StructComplexToken[]
  ) {}

  public getKey() {
    return WorkspaceFilesSystem.getFileBasename(this.path);
  }
}
