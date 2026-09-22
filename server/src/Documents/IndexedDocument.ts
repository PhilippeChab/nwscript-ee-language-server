import { DeclarationKind, ReferenceKind, isBuiltinType } from "../Language";
import type { Declaration, TypeReference, IndexedName, SyntaxIndex, SemanticWorkspace, StandardLibraryDefinitions } from "../Language";
import { STATIC_PREFIX } from "./DocumentsCollection";
import { fileURLToPath } from "url";
import { resourceName } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";

import type DocumentsCollection from "./DocumentsCollection";
import Syntax from "../Language/Syntax";
import SemanticModel from "../Language/SemanticModel";

// Per-file owner of parsed syntax and its derived semantic model. Background
// and bundled documents can hold an index without loading a syntax tree.
export default class IndexedDocument {
  private cachedTypeReferences?: { index: SyntaxIndex; references: TypeReference[] };
  private cachedSemantic?: SemanticModel;

  constructor(readonly uri: string, readonly base: boolean, private readonly source: SyntaxIndex | Syntax, private readonly collection: DocumentsCollection) {}

  public get syntax(): Syntax | undefined {
    return this.source instanceof Syntax ? this.source : undefined;
  }

  public get index(): SyntaxIndex {
    return this.source instanceof Syntax ? this.source.getIndex() : this.source;
  }

  public get semantic(): SemanticModel {
    if (!this.cachedSemantic) throw new Error("Request the analyzed document from DocumentsCollection before using its semantic model");
    return this.cachedSemantic;
  }

  public analyze(library: StandardLibraryDefinitions, workspace: SemanticWorkspace): this {
    const syntax = this.syntax;
    if (!syntax) throw new Error("Parse the source before requesting its semantic model");
    const inputs = [
      ...this.getDocumentsWithDependencies().map((document) => ({ uri: document.uri, owner: document.base ? undefined : document.uri, index: document.index })),
      { uri: library.owner || `${STATIC_PREFIX}/nwscript`, owner: library.owner, index: library },
    ];
    if (!this.cachedSemantic?.matches(inputs)) this.cachedSemantic = new SemanticModel(syntax, inputs, workspace);
    return this;
  }

  public getIncludeName() {
    return resourceName(this.base ? this.uri : fileURLToPath(this.uri));
  }

  public getEntryPointNames(): string[] {
    return (this.index.entryPointDeclarations || []).map((declaration) => declaration.identifier);
  }

  // Transitive include names retain unresolved dependencies and exclude this file.
  public getDependencyNames(): string[] {
    return [...this.walkDependencies()].map(({ name }) => name);
  }

  // The requesting file comes first, followed by resolved dependencies in include order.
  public getDocumentsWithDependencies(): IndexedDocument[] {
    return [this, ...[...this.walkDependencies()].flatMap(({ document }) => (document ? [document] : []))];
  }

  // Each path follows include locations, then the declaration or reference.
  // The final component places an include before a name at the same position.
  public getNameOrder() {
    const order = new Map<IndexedName, number[] | undefined>();
    const add = (document: IndexedDocument, prefix?: number[]) => {
      const index = document.index;
      const declarations = document.getDeclarations(index);
      for (const indexedName of [...declarations, ...(index.memberReferences || []), ...document.getTypeReferences(index, declarations)]) {
        const position = indexedName.kind === DeclarationKind.Function ? indexedName.signatureEnd || indexedName.position : indexedName.position;
        order.set(indexedName, prefix ? [...prefix, position.line, position.character, 1] : undefined);
      }
    };
    add(this, []);
    for (const dependency of this.walkDependencies(true)) {
      if (dependency.document) add(dependency.document, dependency.order);
    }
    return order;
  }

  private getDeclarations(index: SyntaxIndex): Declaration[] {
    const { globalDeclarations, structDeclarations, localDeclarations = [], entryPointDeclarations = [] } = index;
    return [
      ...globalDeclarations,
      ...structDeclarations,
      ...localDeclarations,
      ...entryPointDeclarations,
      ...[...globalDeclarations, ...entryPointDeclarations].flatMap((declaration) => (declaration.kind === DeclarationKind.Function ? declaration.params : [])),
      ...structDeclarations.flatMap((struct) => struct.properties),
    ];
  }

  private getTypeReferences(index: SyntaxIndex, declarations: Declaration[]): TypeReference[] {
    if (this.cachedTypeReferences?.index !== index) {
      // Preserve reference identity within an index for include-once ordering.
      const references: TypeReference[] = declarations.flatMap((declaration) => {
        const type = "valueType" in declaration ? declaration.valueType : "returnType" in declaration ? declaration.returnType : undefined;
        return type && !isBuiltinType(type) ? [{ identifier: type, position: declaration.position, kind: ReferenceKind.Type }] : [];
      });
      this.cachedTypeReferences = { index, references };
    }
    return this.cachedTypeReferences.references;
  }

  private *walkDependencies(withOrder = false): Generator<{ name: string; document?: IndexedDocument; order?: number[] }> {
    // nwscript is implicit and selected per requesting workspace.
    const visited = new Set(["nwscript", this.getIncludeName()]);
    const children = (document: IndexedDocument, parentOrder?: number[]) =>
      document.index.includes
        .map(({ name, position }) => ({ name: name.toLowerCase(), order: parentOrder && position ? [...parentOrder, position.line, position.character, 0] : undefined }))
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
}
