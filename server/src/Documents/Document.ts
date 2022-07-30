import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import type { ComplexToken, StructComplexToken } from "../Tokenizer/types";
import type DocumentsCollection from "./DocumentsCollection";
import { Diagnostic } from "vscode-languageserver";

export type OwnedComplexTokens = { owner: string; tokens: ComplexToken[] };
export type OwnedStructComplexTokens = { owner: string; tokens: StructComplexToken[] };

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

  public getChildren(computedChildren: string[] = []): string[] {
    return this.children.concat(
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

        return childDocument.getChildren(computedChildren);
      })
    );
  }

  public getGlobalComplexTokensWithRef(computedChildren: string[] = []): OwnedComplexTokens[] {
    return [{ owner: this.path, tokens: this.complexTokens }].concat(
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

        return childDocument.getGlobalComplexTokensWithRef(computedChildren);
      })
    );
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

  public getGlobalStructComplexTokensWithRef(computedChildren: string[] = []): OwnedStructComplexTokens[] {
    return [{ owner: this.path, tokens: this.structComplexTokens }].concat(
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

        return childDocument.getGlobalStructComplexTokensWithRef(computedChildren);
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
