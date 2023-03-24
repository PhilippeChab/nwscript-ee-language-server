import type { ComplexToken, StructComplexToken } from "../Tokenizer/types";
import type DocumentsCollection from "./DocumentsCollection";

export type OwnedComplexTokens = { owner: string; tokens: ComplexToken[] };
export type OwnedStructComplexTokens = { owner: string; tokens: StructComplexToken[] };

export default class Document {
  constructor(
    readonly uri: string,
    readonly children: string[],
    readonly complexTokens: ComplexToken[],
    readonly structComplexTokens: StructComplexToken[],
    private readonly collection: DocumentsCollection,
  ) {}

  public getKey() {
    return this.collection.getKey(this.uri);
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
      }),
    );
  }

  public getGlobalComplexTokensWithRef(computedChildren: string[] = []): OwnedComplexTokens[] {
    const localStandardLibDefinitions = this.collection.get("nwscript");
    return [
      { owner: this.uri, tokens: this.complexTokens },
      ...(localStandardLibDefinitions
        ? [{ owner: localStandardLibDefinitions.uri, tokens: localStandardLibDefinitions.complexTokens }]
        : []),
    ].concat(
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

          const childDocument = this.collection.get(child);

          if (!childDocument) {
            return [];
          }

          return childDocument.getGlobalComplexTokens(computedChildren);
        }),
      );
  }

  public getGlobalStructComplexTokensWithRef(computedChildren: string[] = []): OwnedStructComplexTokens[] {
    return [{ owner: this.uri, tokens: this.structComplexTokens }].concat(
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

        const childDocument = this.collection.get(child);

        if (!childDocument) {
          return [];
        }

        return childDocument.getGlobalStructComplexTokens(computedChildren);
      }),
    );
  }

  public debug() {
    console.log("'''''''''''''''''''''");
    console.log(this.getKey());
    console.log("--------------------");
    console.log("getChildren");
    console.log(JSON.stringify(this.getChildren(), null, 2));
    console.log("getGlobalComplexTokensWithRef");
    console.log(JSON.stringify(this.getGlobalComplexTokensWithRef(), null, 2));
    console.log("getGlobalComplexTokens");
    console.log(JSON.stringify(this.getGlobalComplexTokens(), null, 2));
    console.log("getGlobalStructComplexTokensWithRef");
    console.log(JSON.stringify(this.getGlobalStructComplexTokensWithRef(), null, 2));
    console.log("getGlobalStructComplexTokens");
    console.log(JSON.stringify(this.getGlobalStructComplexTokens(), null, 2));
    console.log("'''''''''''''''''''''");
    console.log("");
  }
}
