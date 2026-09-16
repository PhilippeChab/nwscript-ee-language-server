import { CompletionItemKind, type Position } from "vscode-languageserver";
import type Logger from "../Logger/Logger";
import { STATIC_PREFIX } from "./DocumentsCollection";

import type { Declaration, StructDeclaration, TypeReference, IndexedName } from "../Parser/types";
import { LanguageTypes } from "../Parser/constants";
import type DocumentsCollection from "./DocumentsCollection";
import SyntaxDocument from "../Parser/SyntaxDocument";
import type { DocumentIndex } from "../Parser/contracts";

export type OwnedDeclarations = { owner?: string; tokens: Declaration[] };
export type OwnedStructDeclarations = { owner?: string; tokens: StructDeclaration[] };

export default class IndexedDocument {
  private derived?: {
    index: DocumentIndex;
    includes: { name: string; position?: Position }[];
    typeReferences?: TypeReference[];
  };

  constructor(readonly uri: string, readonly base: boolean, private readonly source: DocumentIndex | SyntaxDocument, private readonly collection: DocumentsCollection) {}

  public get syntax() {
    return this.source instanceof SyntaxDocument ? this.source : undefined;
  }

  public get includes() {
    return this.getDerivedIndex().includes;
  }

  public get globalDeclarations() {
    return this.getDerivedIndex().index.globalDeclarations;
  }

  public get structDeclarations() {
    return this.getDerivedIndex().index.structDeclarations;
  }

  public get localDeclarations() {
    return this.getDerivedIndex().index.localDeclarations || [];
  }

  public get memberReferences() {
    return this.getDerivedIndex().index.memberReferences || [];
  }

  public get entryPointDeclarations() {
    return this.getDerivedIndex().index.entryPointDeclarations || [];
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

  // Each path follows include locations, then the declaration or reference.
  // The final component places an include before a name at the same position.
  public getNameOrder(computedChildren: string[] = []) {
    const order = new Map<IndexedName, number[] | undefined>();
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

  private get typeReferences(): TypeReference[] {
    // Preserve reference identity within an index for include-once ordering.
    return (this.getDerivedIndex().typeReferences ||= this.getDeclarations().flatMap((token) => {
      const type = "valueType" in token ? token.valueType : "returnType" in token ? token.returnType : undefined;
      return type && !Object.prototype.hasOwnProperty.call(LanguageTypes, type)
        ? [{ identifier: type, position: token.position, tokenType: CompletionItemKind.Reference, targetKind: "struct" as const }]
        : [];
    }));
  }

  private getDerivedIndex() {
    const index = this.source instanceof SyntaxDocument ? this.source.getIndex() : this.source;
    if (this.derived?.index !== index) {
      // nwscript is implicit and selected per requesting workspace. Keep include
      // locations aligned when excluding it from resource-name lookup.
      const includes = index.children.map((child, i) => ({ name: child.toLowerCase(), position: index.includePositions?.[i] })).filter((child) => child.name !== "nwscript");
      this.derived = { index, includes };
    }
    return this.derived;
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
      document.includes.map(({ name, position }) => ({ name, order: parentOrder && position ? [...parentOrder, position.line, position.character, 0] : undefined })).reverse();
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
