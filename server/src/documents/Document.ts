import type { ComplexToken, StructComplexToken } from "../Tokenizer/types";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import DocumentsCollection from "./DocumentsCollection";

export default class Document {
  constructor(
    readonly path: string,
    readonly children: string[],
    readonly complexTokens: ComplexToken[],
    readonly structComplexTokens: StructComplexToken[],
    private readonly collection: DocumentsCollection
  ) {}

  public getKey() {
    return WorkspaceFilesSystem.getFileBasename(this.path);
  }

  public getGlobalComplexTokens(computedChildren: string[] = []): ComplexToken[] {
    return this.complexTokens.concat(
      this.children.flatMap((child) => {
        // Cycling children or/and duplicates
        if (computedChildren.includes(child)) {
          return [];
        } else {
          computedChildren.push(child);
        }

        const childDocument = this.collection.get(child);

        if (!childDocument) {
          return [];
        }

        return childDocument.getGlobalComplexTokens(computedChildren);
      })
    );
  }

  public getGlobalStructComplexTokens(computedChildren: string[] = []): StructComplexToken[] {
    return this.structComplexTokens.concat(
      this.children.flatMap((child) => {
        // Cycling children or/and duplicates
        if (computedChildren.includes(child)) {
          return [];
        } else {
          computedChildren.push(child);
        }

        const childDocument = this.collection.get(child);

        if (!childDocument) {
          return [];
        }

        return childDocument.getGlobalStructComplexTokens(computedChildren);
      })
    );
  }
}
