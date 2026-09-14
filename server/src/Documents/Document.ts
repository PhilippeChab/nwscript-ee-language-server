import { STATIC_PREFIX } from "./DocumentsCollection";

import type { ComplexToken, StructComplexToken } from "../Tokenizer/types";
import type DocumentsCollection from "./DocumentsCollection";
import type { GlobalScopeTokenizationResult } from "../Tokenizer/Tokenizer";

export type OwnedComplexTokens = { owner?: string; tokens: ComplexToken[] };
export type OwnedStructComplexTokens = { owner?: string; tokens: StructComplexToken[] };

export default class Document {
  constructor(
    readonly uri: string,
    readonly base: boolean,
    readonly children: string[],
    readonly complexTokens: ComplexToken[],
    readonly structComplexTokens: StructComplexToken[],
    private readonly collection: DocumentsCollection,
    readonly entryPoints: string[] = [],
  ) {}

  public getKey() {
    return this.collection.getKey(this.uri, this.base);
  }

  public getIncludeName() {
    const key = this.getKey();
    return this.base ? key.slice(STATIC_PREFIX.length + 1) : key;
  }

  public withGlobalScope(scope: GlobalScopeTokenizationResult) {
    return new Document(
      this.uri,
      this.base,
      scope.children.filter((child) => child.toLowerCase() !== "nwscript"),
      scope.complexTokens,
      scope.structComplexTokens,
      this.collection,
      scope.entryPoints,
    );
  }

  public getEntryPoints(computedChildren: string[] = []): string[] {
    return this.entryPoints.concat(
      this.children.flatMap((child) => {
        if (computedChildren.includes(child)) return [];
        computedChildren.push(child);
        const childDocument = this.collection.get(child) || this.collection.get(`${STATIC_PREFIX}/${child}`);
        return childDocument?.getEntryPoints(computedChildren) || [];
      }),
    );
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

        const childDocument = this.collection.get(child) || this.collection.get(`${STATIC_PREFIX}/${child}`);

        if (!childDocument) {
          return [];
        }

        return childDocument.getChildren(computedChildren);
      }),
    );
  }

  public getGlobalComplexTokensWithRef(computedChildren: string[] = []): OwnedComplexTokens[] {
    return [{ owner: this.base ? undefined : this.uri, tokens: this.complexTokens } as OwnedComplexTokens].concat(
      this.children.flatMap((child) => {
        // Cycling children or/and duplicates
        if (computedChildren.includes(child)) {
          return [];
        } else {
          computedChildren.push(child);
        }

        const childDocument = this.collection.get(child) || this.collection.get(`${STATIC_PREFIX}/${child}`);

        if (!childDocument) {
          return [];
        }

        return childDocument.getGlobalComplexTokensWithRef(computedChildren);
      }),
    );
  }

  public getGlobalComplexTokens(computedChildren: string[] = [], localFunctionIdentifiers: string[] = []): ComplexToken[] {
    return this.complexTokens
      .filter((token) => !localFunctionIdentifiers.includes(token.identifier))
      .concat(
        this.children.flatMap((child) => {
          // Cycling children or/and duplicates
          if (computedChildren.includes(child)) {
            return [];
          } else {
            computedChildren.push(child);
          }

          const childDocument = this.collection.get(child) || this.collection.get(`${STATIC_PREFIX}/${child}`);

          if (!childDocument) {
            return [];
          }

          return childDocument.getGlobalComplexTokens(computedChildren);
        }),
      );
  }

  public getGlobalStructComplexTokensWithRef(computedChildren: string[] = []): OwnedStructComplexTokens[] {
    return [{ owner: this.base ? undefined : this.uri, tokens: this.structComplexTokens } as OwnedStructComplexTokens].concat(
      this.children.flatMap((child) => {
        // Cycling children or/and duplicates
        if (computedChildren.includes(child)) {
          return [];
        } else {
          computedChildren.push(child);
        }

        const childDocument = this.collection.get(child) || this.collection.get(`${STATIC_PREFIX}/${child}`);

        if (!childDocument) {
          return [];
        }

        return childDocument.getGlobalStructComplexTokensWithRef(computedChildren);
      }),
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

        const childDocument = this.collection.get(child) || this.collection.get(`${STATIC_PREFIX}/${child}`);

        if (!childDocument) {
          return [];
        }

        return childDocument.getGlobalStructComplexTokens(computedChildren);
      }),
    );
  }

  public debug() {
    console.error("'''''''''''''''''''''");
    console.error(this.getKey());
    console.error("--------------------");
    console.error("getChildren");
    console.error(JSON.stringify(this.getChildren(), null, 2));
    console.error("getGlobalComplexTokensWithRef");
    console.error(JSON.stringify(this.getGlobalComplexTokensWithRef(), null, 2));
    console.error("getGlobalComplexTokens");
    console.error(JSON.stringify(this.getGlobalComplexTokens(), null, 2));
    console.error("getGlobalStructComplexTokensWithRef");
    console.error(JSON.stringify(this.getGlobalStructComplexTokensWithRef(), null, 2));
    console.error("getGlobalStructComplexTokens");
    console.error(JSON.stringify(this.getGlobalStructComplexTokens(), null, 2));
    console.error("'''''''''''''''''''''");
    console.error("");
  }
}
