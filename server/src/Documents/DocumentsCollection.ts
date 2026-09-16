import type Logger from "../Logger/Logger";
import { join, normalize } from "path";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";

import { CompletionItemKind, Position } from "vscode-languageserver";
import type { Declaration, IndexedName } from "../Parser/types";
import type { ParserService } from "../Parser";
import { DocumentIndex, AnalysisMode } from "../Parser/ParserService";
import { Dictionnary, normalizeDocumentUri } from "../Utils";
import IndexedDocument from "./IndexedDocument";
import readDocumentIndex from "./readDocumentIndex";
import type SyntaxDocument from "../Parser/SyntaxDocument";
import WorkspaceFilesSystem, { FILES_EXTENSION, resourceName } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";
import { isStandardLibrary } from "./StandardLibrary";

const MAX_RESREF_BYTES = 16;
const STATIC_RESOURCES_FOLDERS = ["base_scripts", "ovr"];
export const STATIC_PREFIX = "static";

export default class DocumentsCollection extends Dictionnary<string, IndexedDocument> {
  // Requests identify an exact document; basename lookup is only for includes.
  private readonly documentsByUri = new Map<string, IndexedDocument>();
  // Live syntax is separate from the last usable include-index snapshot. A
  // document's mutable parse must not change that fallback after a failed save.
  private readonly parsedDocuments = new WeakMap<TextDocument, IndexedDocument>();
  private importChildren = new WeakMap<IndexedDocument, Set<string>>();

  constructor() {
    super();

    STATIC_RESOURCES_FOLDERS.forEach((staticResourcesFolder) => {
      const directoryPath = normalize(join(__dirname, "..", "resources", staticResourcesFolder));
      const files = readdirSync(directoryPath);
      files.forEach((filename) => {
        const documentIndex = readDocumentIndex(readFileSync(join(__dirname, "..", "resources", staticResourcesFolder, filename), "utf8"));
        this.addDocument(this.createIndexedDocument(`${STATIC_PREFIX}/${filename.replace(".json", FILES_EXTENSION)}`, true, documentIndex));
      });
    });
  }

  public createIndexedDocument(uri: string, base: boolean, source: DocumentIndex | SyntaxDocument) {
    return new IndexedDocument(base ? uri : normalizeDocumentUri(uri), base, source, this);
  }

  public getParsedDocument(document: TextDocument, parserService: ParserService) {
    const syntax = parserService.parse(document);
    let indexed = this.parsedDocuments.get(document);
    if (!indexed || indexed.syntax !== syntax) {
      indexed = this.createIndexedDocument(document.uri, false, syntax);
      this.parsedDocuments.set(document, indexed);
    }
    return indexed;
  }

  public getKey(uri: string, base: boolean) {
    return base ? `${STATIC_PREFIX}/${resourceName(uri)}` : resourceName(fileURLToPath(uri));
  }

  public get(key: string) {
    return super.get(key.toLowerCase());
  }

  public resolveInclude(name: string) {
    return this.get(name) || this.get(`${STATIC_PREFIX}/${name}`);
  }

  public getWorkspaceDocuments() {
    return [...this.documentsByUri.values()];
  }

  public removeDocument(uri: string) {
    uri = normalizeDocumentUri(uri);
    const document = this.documentsByUri.get(uri);
    if (!document) return;
    this.documentsByUri.delete(uri);
    this.importChildren = new WeakMap();
    const key = document.getKey();
    if (this.get(key)?.uri !== uri) return;
    this.delete(key);
    const replacement = this.getWorkspaceDocuments().find((candidate) => candidate.getKey() === key);
    if (replacement) this.add(key, replacement);
  }

  public getFromUri(uri: string) {
    return this.documentsByUri.get(normalizeDocumentUri(uri));
  }

  public getImportableDocuments(
    document: IndexedDocument,
    getMatches: (candidate: IndexedDocument) => Declaration[],
    implicitDeclarations: Declaration[] = [],
    insertionPosition: Position = { line: 0, character: 0 },
    referencePosition: Position = insertionPosition,
  ) {
    const included = new Set(document.getChildren());
    const entryPoints = new Set(document.entryPoints);
    for (const child of included) {
      const dependency = this.resolveInclude(child);
      dependency?.entryPoints.forEach((entryPoint) => entryPoints.add(entryPoint));
    }
    const conflicts = (source: IndexedDocument | undefined) => source?.entryPoints.some((entryPoint) => entryPoints.has(entryPoint));
    const implicitNames = new Set<IndexedName>(implicitDeclarations);
    const currentDeclarations = new Set<IndexedName>(document.globalDeclarations);
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
    const isScoped = (indexedName: IndexedName) =>
      indexedName.tokenType === CompletionItemKind.Variable || indexedName.tokenType === CompletionItemKind.TypeParameter || indexedName.tokenType === CompletionItemKind.Property;
    const isReserved = (indexedName: IndexedName) =>
      indexedName.tokenType === CompletionItemKind.Function || (indexedName.tokenType === CompletionItemKind.Constant && (indexedName.isConst || implicitNames.has(indexedName)));
    const namesConflict = (left: IndexedName, right: IndexedName, order: Map<IndexedName, number[] | undefined>) => {
      // Paths interleave declarations with their includes at the actual source
      // positions. Unknown legacy include positions retain conservative checks.
      const leftOrder = order.get(left);
      const rightOrder = order.get(right);
      const knownOrder = leftOrder !== undefined && rightOrder !== undefined;
      const leftFirst = knownOrder && compareOrder(leftOrder, rightOrder) < 0;
      const earlier = leftFirst ? left : right;
      const later = leftFirst ? right : left;
      if (left.tokenType === CompletionItemKind.Reference || right.tokenType === CompletionItemKind.Reference) {
        const reference = left.tokenType === CompletionItemKind.Reference ? left : right;
        const other = reference === left ? right : left;
        // A constant replaces identifiers even after a dot; function names do
        // not. Earlier field declarations alone remain legal.
        return Boolean(
          (other.tokenType === CompletionItemKind.Constant || (reference.tokenType === CompletionItemKind.Reference && reference.targetKind === "struct")) &&
            isReserved(other) &&
            (implicitNames.has(other) || !knownOrder || earlier === other),
        );
      }
      if (isScoped(left) || isScoped(right)) {
        const scoped = isScoped(left) ? left : right;
        const other = scoped === left ? right : left;
        return Boolean(isReserved(other) && (implicitNames.has(other) || !knownOrder || earlier === other));
      }
      if (
        (knownOrder || currentDeclarations.has(left)) &&
        (later.tokenType === CompletionItemKind.Function || (later.tokenType === CompletionItemKind.Constant && later.isConst)) &&
        (earlier.tokenType === CompletionItemKind.Struct || (earlier.tokenType === CompletionItemKind.Constant && !earlier.isConst))
      ) {
        return false;
      }
      if (left.tokenType === CompletionItemKind.Struct || right.tokenType === CompletionItemKind.Struct) {
        const other = left.tokenType === CompletionItemKind.Struct ? right : left;
        // Struct tags and ordinary variables are separate namespaces. Functions
        // and const names reserve lexer tokens that can invalidate struct uses.
        // API constants are reserved even when nwscript.nss omits const.
        return other.tokenType !== CompletionItemKind.Constant || other.isConst === true || implicitNames.has(other);
      }
      if (left.tokenType !== CompletionItemKind.Function || right.tokenType !== CompletionItemKind.Function) return true;
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
      return matches.filter((declaration) => declaration.tokenType !== CompletionItemKind.Struct || !reservedNames.has(declaration.identifier));
    };
    const currentName = document.getIncludeName();
    const candidates: { document: IndexedDocument; declarations: Declaration[] }[] = [];
    this.forEach((candidate) => {
      const name = candidate.getIncludeName();
      if (name === currentName || name.toLowerCase() === "nwscript" || included.has(name)) return;
      if (Buffer.byteLength(name, "utf8") > MAX_RESREF_BYTES || ['"', "\r", "\n", "\\"].some((character) => name.includes(character))) return;
      // Use the same workspace-over-bundled selection as include resolution.
      if (candidate.base && this.get(name)) return;
      // Match symbols before walking dependencies or constructing completion edits.
      const matches = getMatches(candidate);
      if (!matches.length) return;
      let children = this.importChildren.get(candidate);
      if (!children) {
        children = new Set(candidate.getChildren());
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

  public createDocument(uri: string, documentIndex: DocumentIndex) {
    const document = this.createIndexedDocument(uri, false, documentIndex);
    if (isStandardLibrary(uri)) this.overwriteDocument(document);
    else this.addDocument(document);
  }

  public createDocuments(uri: string, content: string, parserService: ParserService, workespaceFilesSystem: WorkspaceFilesSystem) {
    const documentIndex = parserService.analyzeContent(content, AnalysisMode.document);

    this.addDocument(this.createIndexedDocument(uri, false, documentIndex));
    this.createChildrenDocument(documentIndex.includes, parserService, workespaceFilesSystem);
  }

  public updateDocument(document: TextDocument, parserService: ParserService, workespaceFilesSystem: WorkspaceFilesSystem) {
    // willSave and didSave can describe the same document version. Reuse its
    // index, but still retry missing includes that may have appeared on disk.
    const documentIndex = parserService.getDocumentIndex(document);

    this.overwriteDocument(this.createIndexedDocument(document.uri, false, documentIndex));
    // Already-declared includes may have failed indexing and since been repaired.
    // createChildrenDocument skips includes that are already available.
    this.createChildrenDocument(documentIndex.includes, parserService, workespaceFilesSystem);
  }

  public debug(logger: Logger) {
    this.forEach((document) => document.debug(logger));
  }

  private addDocument(document: IndexedDocument) {
    this.importChildren = new WeakMap();
    if (!document.base && !this.documentsByUri.has(document.uri)) this.documentsByUri.set(document.uri, document);
    this.add(document.getKey(), document);
  }

  private overwriteDocument(document: IndexedDocument) {
    this.importChildren = new WeakMap();
    if (!document.base) this.documentsByUri.set(document.uri, document);
    // Updating a duplicate's own contents must not change include selection.
    const selected = this.get(document.getKey());
    if (!selected || selected.uri === document.uri) this.overwrite(document.getKey(), document);
  }

  private createChildrenDocument(includes: DocumentIndex["includes"], parserService: ParserService, workespaceFilesSystem: WorkspaceFilesSystem) {
    includes.forEach(({ name: child }) => {
      if (child.toLowerCase() === "nwscript" || this.get(child)) return;
      const filePath = workespaceFilesSystem.getFilePath(child);
      if (!filePath) return;

      const uri = pathToFileURL(filePath).href;
      if (this.get(this.getKey(uri, false))) return;

      const fileContent = readFileSync(filePath).toString();
      this.createDocuments(uri, fileContent, parserService, workespaceFilesSystem);
    });
  }
}
