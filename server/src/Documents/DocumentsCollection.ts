import { DeclarationKind, ReferenceKind } from "../Language";
import type { Declaration, IndexedName, SyntaxIndex, ImportCandidate, AutoImportContext, StandardLibraryDefinitions } from "../Language";
import { join } from "path";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";

import { Position } from "vscode-languageserver";
import type Parser from "../Language/Parser";
import { normalizeDocumentUri } from "../Utils";
import IndexedDocument from "./IndexedDocument";
import type Syntax from "../Language/Syntax";
import WorkspaceFilesSystem, { FILES_EXTENSION, resourceName } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";
import { isStandardLibrary } from "./StandardLibrary";

const MAX_RESREF_BYTES = 16;
const STATIC_RESOURCES_FOLDERS = ["base_scripts", "ovr"];
export const STATIC_PREFIX = "static";

export default class DocumentsCollection {
  private readonly documentsByInclude = new Map<string, IndexedDocument>();
  // Requests identify an exact document; basename lookup is only for includes.
  private readonly documentsByUri = new Map<string, IndexedDocument>();
  // Live file objects own their analysis independently of saved include indexes.
  private readonly indexedDocuments = new WeakMap<TextDocument, IndexedDocument>();
  private importChildren = new WeakMap<IndexedDocument, Set<string>>();

  constructor() {
    STATIC_RESOURCES_FOLDERS.forEach((staticResourcesFolder) => {
      const directoryPath = join(__dirname, "..", "resources", staticResourcesFolder);
      const files = readdirSync(directoryPath);
      files.forEach((filename) => {
        const syntaxIndex = JSON.parse(readFileSync(join(directoryPath, filename), "utf8")) as SyntaxIndex;
        this.storeDocument(this.createDocument(`${STATIC_PREFIX}/${filename.replace(".json", FILES_EXTENSION)}`, true, syntaxIndex));
      });
    });
  }

  public getDocument(document: TextDocument, parser: Parser, library: StandardLibraryDefinitions, getLiveDocument: (uri: string) => TextDocument | undefined = () => undefined): IndexedDocument {
    const syntax = parser.parse(document);
    const cached = this.indexedDocuments.get(document);
    const indexed = cached?.syntax === syntax ? cached : this.createDocument(document.uri, false, syntax);
    if (indexed !== cached) {
      this.indexedDocuments.set(document, indexed);
    }
    return indexed.analyze(library, {
      getImportCandidates: (context, visible, limit) => this.getAutoImportCandidates(indexed, library, context, visible, limit),
      getFunctionDeclarations: (uri) => this.readFunctionDeclarations(uri, parser, getLiveDocument),
    });
  }

  public getWorkspaceDocument(uri: string) {
    return this.documentsByUri.get(normalizeDocumentUri(uri));
  }

  public getWorkspaceDocuments() {
    return [...this.documentsByUri.values()];
  }

  public getWorkspaceInclude(name: string) {
    return this.documentsByInclude.get(name.toLowerCase());
  }

  public resolveInclude(name: string) {
    return this.getWorkspaceInclude(name) || this.documentsByInclude.get(`${STATIC_PREFIX}/${name.toLowerCase()}`);
  }

  public addDocument(uri: string, syntaxIndex: SyntaxIndex) {
    // Background indexes must not replace a newer editor snapshot. The API is
    // refreshed independently and can replace its previous usable index.
    this.storeDocument(this.createDocument(uri, false, syntaxIndex), isStandardLibrary(uri));
  }

  public updateDocument(document: TextDocument, parser: Parser, workspaceFilesSystem: WorkspaceFilesSystem) {
    // willSave and didSave can describe the same document version. Reuse its
    // index, but still retry missing includes that may have appeared on disk.
    const syntaxIndex = parser.parse(document).getIndex(true);

    this.storeDocument(this.createDocument(document.uri, false, syntaxIndex), true);
    // Already-declared includes may have failed indexing and since been repaired.
    // indexIncludes skips includes that are already available.
    this.indexIncludes(syntaxIndex.includes, parser, workspaceFilesSystem);
  }

  public removeDocument(uri: string) {
    uri = normalizeDocumentUri(uri);
    const document = this.documentsByUri.get(uri);
    if (!document) return;
    this.documentsByUri.delete(uri);
    this.importChildren = new WeakMap();
    const name = document.getIncludeName();
    if (this.getWorkspaceInclude(name)?.uri !== uri) return;
    this.documentsByInclude.delete(name);
    const replacement = this.getWorkspaceDocuments().find((candidate) => candidate.getIncludeName() === name);
    if (replacement) this.documentsByInclude.set(name, replacement);
  }

  private createDocument(uri: string, base: boolean, source: SyntaxIndex | Syntax) {
    return new IndexedDocument(base ? uri : normalizeDocumentUri(uri), base, source, this);
  }

  private storeDocument(document: IndexedDocument, replaceExisting = false) {
    this.importChildren = new WeakMap();
    if (!document.base && (replaceExisting || !this.documentsByUri.has(document.uri))) this.documentsByUri.set(document.uri, document);
    // Updating a duplicate's own contents must not change include selection.
    const name = document.getIncludeName();
    const key = document.base ? `${STATIC_PREFIX}/${name}` : name;
    const selected = this.documentsByInclude.get(key);
    if (!selected || (replaceExisting && selected.uri === document.uri)) this.documentsByInclude.set(key, document);
  }

  private readFunctionDeclarations(uri: string, parser: Parser, getLiveDocument: (uri: string) => TextDocument | undefined) {
    const live = getLiveDocument(uri);
    if (live) return parser.parse(live).getFunctionDeclarations();
    let source: TextDocument;
    try {
      source = TextDocument.create(uri, "nwscript", 0, readFileSync(fileURLToPath(uri), "utf8"));
    } catch {
      // A dependency can disappear between indexing and navigation.
      return [];
    }
    const syntax = parser.parseContent(source);
    try {
      return syntax.getFunctionDeclarations();
    } finally {
      syntax.dispose();
    }
  }

  private indexIncludes(includes: SyntaxIndex["includes"], parser: Parser, workspaceFilesSystem: WorkspaceFilesSystem) {
    includes.forEach(({ name: child }) => {
      if (child.toLowerCase() === "nwscript" || this.getWorkspaceInclude(child)) return;
      const filePath = workspaceFilesSystem.getFilePath(child);
      if (!filePath) return;

      const uri = pathToFileURL(filePath).href;
      if (this.getWorkspaceInclude(resourceName(filePath))) return;

      const source = TextDocument.create(uri, "nwscript", 0, readFileSync(filePath, "utf8"));
      const syntaxIndex = parser.indexContent(source);
      this.addDocument(uri, syntaxIndex);
      this.indexIncludes(syntaxIndex.includes, parser, workspaceFilesSystem);
    });
  }

  private getAutoImportCandidates(document: IndexedDocument, library: StandardLibraryDefinitions, context: AutoImportContext, visibleNames: Set<string>, limit: number): ImportCandidate[] {
    const prefix = context.prefix.toLowerCase();
    const candidates = this.findImportableDocuments(
      document,
      (candidate) => {
        const declarations: Declaration[] = context.structsOnly ? candidate.index.structDeclarations : candidate.index.globalDeclarations;
        const seen = new Set<string>();
        return declarations.filter((declaration) => {
          if (
            !declaration.identifier.toLowerCase().startsWith(prefix) ||
            visibleNames.has(declaration.identifier) ||
            seen.has(declaration.identifier) ||
            declaration.identifier === "main" ||
            declaration.identifier === "StartingConditional"
          ) {
            return false;
          }
          seen.add(declaration.identifier);
          return true;
        });
      },
      [...library.globalDeclarations, ...library.structDeclarations],
      context.insertionPosition,
      context.replacementRange.start,
    );
    const imports: ImportCandidate[] = [];
    for (const { document: candidate, declarations } of candidates) {
      for (const declaration of declarations) {
        imports.push({ declaration, includeName: candidate.getIncludeName() });
        if (imports.length === limit) return imports;
      }
    }
    return imports;
  }

  private findImportableDocuments(
    document: IndexedDocument,
    getMatches: (candidate: IndexedDocument) => Declaration[],
    implicitDeclarations: Declaration[],
    insertionPosition: Position,
    referencePosition: Position,
  ) {
    const included = new Set(document.getDependencyNames());
    const entryPoints = new Set(document.getEntryPointNames());
    for (const child of included) {
      const dependency = this.resolveInclude(child);
      dependency?.getEntryPointNames().forEach((entryPoint) => entryPoints.add(entryPoint));
    }
    const conflicts = (source: IndexedDocument | undefined) => source?.getEntryPointNames().some((entryPoint) => entryPoints.has(entryPoint));
    const implicitNames = new Set<IndexedName>(implicitDeclarations);
    const currentDeclarations = new Set<IndexedName>(document.index.globalDeclarations);
    const visible = new Map<string, IndexedName[]>();
    const visibleNames = new Set<IndexedName>();
    const existingOrder = document.getNameOrder();
    for (const indexedName of [...existingOrder.keys(), ...implicitDeclarations]) {
      visibleNames.add(indexedName);
      visible.set(indexedName.identifier, [...(visible.get(indexedName.identifier) || []), indexedName]);
    }
    const compareOrder = (left: number[], right: number[]) => {
      for (let index = 0; index < Math.min(left.length, right.length); index++) {
        if (left[index] !== right[index]) return left[index] - right[index];
      }
      return left.length - right.length;
    };
    const isReference = (indexedName: IndexedName) => indexedName.kind === ReferenceKind.Member || indexedName.kind === ReferenceKind.Type;
    const isScoped = (indexedName: IndexedName) =>
      (indexedName.kind === DeclarationKind.Variable && indexedName.scope === "local") || indexedName.kind === DeclarationKind.Parameter || indexedName.kind === DeclarationKind.Field;
    const isReserved = (indexedName: IndexedName) => indexedName.kind === DeclarationKind.Function || indexedName.kind === DeclarationKind.Constant;
    const namesConflict = (left: IndexedName, right: IndexedName, order: Map<IndexedName, number[] | undefined>) => {
      // Paths interleave declarations with their includes at the actual source
      // positions. Unknown legacy include positions retain conservative checks.
      const leftOrder = order.get(left);
      const rightOrder = order.get(right);
      const knownOrder = leftOrder !== undefined && rightOrder !== undefined;
      const leftFirst = knownOrder && compareOrder(leftOrder, rightOrder) < 0;
      const earlier = leftFirst ? left : right;
      const later = leftFirst ? right : left;
      if (isReference(left) || isReference(right)) {
        const reference = isReference(left) ? left : right;
        const other = reference === left ? right : left;
        // A constant replaces identifiers even after a dot; function names do
        // not. Earlier field declarations alone remain legal.
        return Boolean((other.kind === DeclarationKind.Constant || reference.kind === ReferenceKind.Type) && isReserved(other) && (implicitNames.has(other) || !knownOrder || earlier === other));
      }
      if (isScoped(left) || isScoped(right)) {
        const scoped = isScoped(left) ? left : right;
        const other = scoped === left ? right : left;
        return Boolean(isReserved(other) && (implicitNames.has(other) || !knownOrder || earlier === other));
      }
      if (
        (knownOrder || currentDeclarations.has(left)) &&
        (later.kind === DeclarationKind.Function || (later.kind === DeclarationKind.Constant && !implicitNames.has(later))) &&
        (earlier.kind === DeclarationKind.Struct || (earlier.kind === DeclarationKind.Variable && earlier.scope === "global"))
      ) {
        return false;
      }
      if (left.kind === DeclarationKind.Struct || right.kind === DeclarationKind.Struct) {
        const other = left.kind === DeclarationKind.Struct ? right : left;
        // Struct tags and ordinary variables are separate namespaces. Functions
        // and const names reserve lexer tokens that can invalidate struct uses.
        // API constants are reserved even when nwscript.nss omits const.
        return other.kind !== DeclarationKind.Variable || other.scope !== "global";
      }
      if (left.kind !== DeclarationKind.Function || right.kind !== DeclarationKind.Function) return true;
      // Engine API declarations already have implementations, despite prototype syntax.
      return (
        ((left.implementation || implicitNames.has(left)) && (right.implementation || implicitNames.has(right))) ||
        left.returnType !== right.returnType ||
        left.params.length !== right.params.length ||
        left.params.some((param, index) => param.valueType !== right.params[index].valueType)
      );
    };
    const getSafeMatches = (candidate: IndexedDocument, matches: Declaration[]) => {
      const introduced = new Map<string, IndexedName[]>();
      const incomingOrder = candidate.getNameOrder();
      const order = new Map(existingOrder);
      for (const [indexedName, path] of incomingOrder) {
        // The inserted include precedes an existing declaration or reference at the same position.
        const incoming = path && [insertionPosition.line, insertionPosition.character, -1, ...path];
        const existing = order.get(indexedName);
        order.set(indexedName, incoming && existing ? (compareOrder(incoming, existing) < 0 ? incoming : existing) : incoming);
      }
      for (const indexedName of incomingOrder.keys()) {
        if (visibleNames.has(indexedName)) {
          const before = existingOrder.get(indexedName);
          const after = order.get(indexedName);
          // Include-once dependencies can move earlier when reached through the
          // new helper. Recheck declarations whose effective position changes.
          if (!before || !after || compareOrder(after, before) >= 0) continue;
        }
        const prior = introduced.get(indexedName.identifier) || [];
        if ([...(visible.get(indexedName.identifier) || []), ...prior].some((existing) => existing !== indexedName && namesConflict(existing, indexedName, order))) return [];
        if (!visibleNames.has(indexedName)) introduced.set(indexedName.identifier, [...prior, indexedName]);
      }
      // Accepting a struct completion introduces a type use at the cursor,
      // which can be later than a legal same-named declaration in the script.
      const reference = [referencePosition.line, referencePosition.character, 1];
      const reservedNames = new Set(
        [...order.keys(), ...implicitDeclarations]
          .filter((indexedName) => {
            const position = order.get(indexedName);
            return isReserved(indexedName) && (!position || compareOrder(position, reference) < 0);
          })
          .map((indexedName) => indexedName.identifier),
      );
      return matches.filter((declaration) => declaration.kind !== DeclarationKind.Struct || !reservedNames.has(declaration.identifier));
    };
    const currentName = document.getIncludeName();
    const candidates: { document: IndexedDocument; declarations: Declaration[] }[] = [];
    this.documentsByInclude.forEach((candidate) => {
      const name = candidate.getIncludeName();
      if (name === currentName || name.toLowerCase() === "nwscript" || included.has(name)) return;
      if (Buffer.byteLength(name, "utf8") > MAX_RESREF_BYTES || ['"', "\r", "\n", "\\"].some((character) => name.includes(character))) return;
      // Use the same workspace-over-bundled selection as include resolution.
      if (candidate.base && this.getWorkspaceInclude(name)) return;
      // Match symbols before walking dependencies or constructing completion edits.
      const matches = getMatches(candidate);
      if (!matches.length) return;
      let children = this.importChildren.get(candidate);
      if (!children) {
        children = new Set(candidate.getDependencyNames());
        this.importChildren.set(candidate, children);
      }
      if (children.has(currentName) || conflicts(candidate)) return;
      // Already included dependencies do not add another implementation.
      for (const child of children) {
        if (!included.has(child) && conflicts(this.resolveInclude(child))) return;
      }
      const declarations = getSafeMatches(candidate, matches);
      if (declarations.length) candidates.push({ document: candidate, declarations });
    });
    // Keep workspace symbols ahead of bundled symbols in bounded completion lists.
    return candidates.sort((left, right) => Number(left.document.base) - Number(right.document.base));
  }
}
