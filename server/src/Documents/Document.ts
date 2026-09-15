import { CompletionItemKind, type Position } from "vscode-languageserver";
import type Logger from "../Logger/Logger";
import { STATIC_PREFIX } from "./DocumentsCollection";

import type { ComplexToken, FunctionComplexToken, StructComplexToken } from "../Tokenizer/types";
import { LanguageTypes } from "../Tokenizer/constants";
import type DocumentsCollection from "./DocumentsCollection";

export type OwnedComplexTokens = { owner?: string; tokens: ComplexToken[] };
export type OwnedStructComplexTokens = { owner?: string; tokens: StructComplexToken[] };

export default class Document {
  private readonly typeReferences: ComplexToken[];
  constructor(
    readonly uri: string,
    readonly base: boolean,
    readonly children: string[],
    readonly globalDeclarations: ComplexToken[],
    readonly structDeclarations: StructComplexToken[],
    private readonly collection: DocumentsCollection,
    readonly includePositions: (Position | undefined)[] = [],
    readonly localDeclarations: ComplexToken[] = [],
    readonly memberReferences: ComplexToken[] = [],
    readonly entryPointDeclarations: FunctionComplexToken[] = [],
  ) {
    // Type uses are already represented by parsed declaration types. Retain
    // their identity so shared dependencies still follow include-once ordering.
    this.typeReferences = this.getDeclarations().flatMap((token) => {
      const type = "valueType" in token ? token.valueType : "returnType" in token ? token.returnType : undefined;
      return type && !Object.prototype.hasOwnProperty.call(LanguageTypes, type)
        ? [{ identifier: type, position: token.position, tokenType: CompletionItemKind.Reference, targetKind: "struct" as const }]
        : [];
    });
  }

  public get entryPoints(): string[] {
    return this.entryPointDeclarations.map((declaration) => declaration.identifier);
  }

  public getKey() {
    return this.collection.getKey(this.uri, this.base);
  }

  public getIncludeName() {
    const key = this.getKey();
    return this.base ? key.slice(STATIC_PREFIX.length + 1) : key;
  }

  // Each path follows include locations, then the declaration location. The
  // final component distinguishes an include from a declaration at that position.
  public getDeclarationOrder(computedChildren: string[] = []) {
    const order = new Map<ComplexToken, number[] | undefined>();
    const add = (document: Document, prefix?: number[]) => {
      for (const token of [...document.getDeclarations(), ...document.memberReferences, ...document.typeReferences]) {
        const position = token.tokenType === CompletionItemKind.Function ? token.signatureEnd || token.position : token.position;
        order.set(token, prefix ? [...prefix, position.line, position.character, 1] : undefined);
      }
    };
    add(this, []);
    for (const dependency of this.dependencies(computedChildren, true)) {
      if (dependency.document) add(dependency.document, dependency.order);
    }
    return order;
  }

  public getChildren(computedChildren: string[] = []): string[] {
    return [...this.dependencies(computedChildren)].map(({ name }) => name);
  }

  public getGlobalComplexTokensWithRef(computedChildren: string[] = []): OwnedComplexTokens[] {
    return this.getDocuments(computedChildren).map((document) => ({ owner: document.base ? undefined : document.uri, tokens: document.globalDeclarations }));
  }

  public getGlobalComplexTokens(computedChildren: string[] = [], localFunctionIdentifiers: string[] = []): ComplexToken[] {
    return this.getDocuments(computedChildren).flatMap((document) => document.globalDeclarations.filter((token) => document !== this || !localFunctionIdentifiers.includes(token.identifier)));
  }

  public getGlobalStructComplexTokensWithRef(computedChildren: string[] = []): OwnedStructComplexTokens[] {
    return this.getDocuments(computedChildren).map((document) => ({ owner: document.base ? undefined : document.uri, tokens: document.structDeclarations }));
  }

  public getGlobalStructComplexTokens(computedChildren: string[] = []): StructComplexToken[] {
    return this.getDocuments(computedChildren).flatMap((document) => document.structDeclarations);
  }

  public debug(logger: Logger) {
    logger.debug("'''''''''''''''''''''");
    logger.debug(this.getKey());
    logger.debug("--------------------");
    logger.debug("getChildren");
    logger.debug(JSON.stringify(this.getChildren(), null, 2));
    logger.debug("getGlobalComplexTokensWithRef");
    logger.debug(JSON.stringify(this.getGlobalComplexTokensWithRef(), null, 2));
    logger.debug("getGlobalComplexTokens");
    logger.debug(JSON.stringify(this.getGlobalComplexTokens(), null, 2));
    logger.debug("getGlobalStructComplexTokensWithRef");
    logger.debug(JSON.stringify(this.getGlobalStructComplexTokensWithRef(), null, 2));
    logger.debug("getGlobalStructComplexTokens");
    logger.debug(JSON.stringify(this.getGlobalStructComplexTokens(), null, 2));
    logger.debug("'''''''''''''''''''''");
    logger.debug("");
  }

  private getDeclarations() {
    return [
      ...this.globalDeclarations,
      ...this.structDeclarations,
      ...this.localDeclarations,
      ...this.entryPointDeclarations,
      ...[...this.globalDeclarations, ...this.entryPointDeclarations].flatMap((token) => (token.tokenType === CompletionItemKind.Function ? token.params : [])),
      ...this.structDeclarations.flatMap((struct) => struct.properties),
    ];
  }

  private *dependencies(computedChildren: string[] = [], withOrder = false): Generator<{ name: string; document?: Document; order?: number[] }> {
    const visited = new Set([this.getIncludeName(), ...computedChildren]);
    const children = (document: Document, parentOrder?: number[]) =>
      document.children
        .map((name, index) => {
          const position = document.includePositions[index];
          return { name, order: parentOrder && position ? [...parentOrder, position.line, position.character, 0] : undefined };
        })
        .reverse();
    const pending = children(this, withOrder ? [] : undefined);
    while (pending.length) {
      const next = pending.pop();
      if (!next) break;
      const { name, order } = next;
      if (visited.has(name)) continue;
      visited.add(name);
      const document = this.collection.resolveInclude(name);
      yield { name, document, order };
      if (document) pending.push(...children(document, order));
    }
  }

  private getDocuments(computedChildren: string[] = []): Document[] {
    return [this, ...[...this.dependencies(computedChildren)].flatMap(({ document }) => (document ? [document] : []))];
  }
}
