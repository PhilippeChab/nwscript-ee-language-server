import { CompletionItemKind, type Position } from "vscode-languageserver";
import type Logger from "../Logger/Logger";
import { STATIC_PREFIX } from "./DocumentsCollection";

import type { Declaration, FunctionDeclaration, StructDeclaration } from "../Parser/types";
import { LanguageTypes } from "../Parser/constants";
import type DocumentsCollection from "./DocumentsCollection";

export type OwnedDeclarations = { owner?: string; tokens: Declaration[] };
export type OwnedStructDeclarations = { owner?: string; tokens: StructDeclaration[] };

export default class IndexedDocument {
  private readonly typeReferences: Declaration[];
  constructor(
    readonly uri: string,
    readonly base: boolean,
    readonly children: string[],
    readonly globalDeclarations: Declaration[],
    readonly structDeclarations: StructDeclaration[],
    readonly includePositions: (Position | undefined)[] = [],
    readonly localDeclarations: Declaration[] = [],
    readonly memberReferences: Declaration[] = [],
    readonly entryPointDeclarations: FunctionDeclaration[] = [],
    private readonly collection: DocumentsCollection,
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
    const order = new Map<Declaration, number[] | undefined>();
    const add = (document: IndexedDocument, prefix?: number[]) => {
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

  public getGlobalDeclarationsWithOwner(computedChildren: string[] = []): OwnedDeclarations[] {
    return this.getDocuments(computedChildren).map((document) => ({ owner: document.base ? undefined : document.uri, tokens: document.globalDeclarations }));
  }

  public getGlobalDeclarations(computedChildren: string[] = [], localFunctionIdentifiers: string[] = []): Declaration[] {
    return this.getDocuments(computedChildren).flatMap((document) => document.globalDeclarations.filter((token) => document !== this || !localFunctionIdentifiers.includes(token.identifier)));
  }

  public getStructDeclarationsWithOwner(computedChildren: string[] = []): OwnedStructDeclarations[] {
    return this.getDocuments(computedChildren).map((document) => ({ owner: document.base ? undefined : document.uri, tokens: document.structDeclarations }));
  }

  public getStructDeclarations(computedChildren: string[] = []): StructDeclaration[] {
    return this.getDocuments(computedChildren).flatMap((document) => document.structDeclarations);
  }

  public debug(logger: Logger) {
    logger.debug("'''''''''''''''''''''");
    logger.debug(this.getKey());
    logger.debug("--------------------");
    logger.debug("getChildren");
    logger.debug(JSON.stringify(this.getChildren(), null, 2));
    logger.debug("getGlobalDeclarationsWithOwner");
    logger.debug(JSON.stringify(this.getGlobalDeclarationsWithOwner(), null, 2));
    logger.debug("getGlobalDeclarations");
    logger.debug(JSON.stringify(this.getGlobalDeclarations(), null, 2));
    logger.debug("getStructDeclarationsWithOwner");
    logger.debug(JSON.stringify(this.getStructDeclarationsWithOwner(), null, 2));
    logger.debug("getStructDeclarations");
    logger.debug(JSON.stringify(this.getStructDeclarations(), null, 2));
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

  private *dependencies(computedChildren: string[] = [], withOrder = false): Generator<{ name: string; document?: IndexedDocument; order?: number[] }> {
    const visited = new Set([this.getIncludeName(), ...computedChildren]);
    const children = (document: IndexedDocument, parentOrder?: number[]) =>
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

  private getDocuments(computedChildren: string[] = []): IndexedDocument[] {
    return [this, ...[...this.dependencies(computedChildren)].flatMap(({ document }) => (document ? [document] : []))];
  }
}
