import type Logger from "../Logger/Logger";
import { join, normalize } from "path";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";

import { CompletionItemKind, Position } from "vscode-languageserver";
import type { ComplexToken } from "../Tokenizer/types";
import type { Tokenizer } from "../Tokenizer";
import { DocumentTokenizationResult, TokenizationMode } from "../Tokenizer/Tokenizer";
import { Dictionnary, normalizeDocumentUri } from "../Utils";
import Document from "./Document";
import WorkspaceFilesSystem, { FILES_EXTENSION, resourceName } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";
import { isStandardLibrary } from "./StandardLibrary";

const MAX_RESREF_BYTES = 16;
const STATIC_RESOURCES_FOLDERS = ["base_scripts", "ovr"];
export const STATIC_PREFIX = "static";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  // Requests identify an exact document; basename lookup is only for includes.
  private readonly documentsByUri = new Map<string, Document>();
  private importChildren = new WeakMap<Document, Set<string>>();

  constructor() {
    super();

    STATIC_RESOURCES_FOLDERS.forEach((staticResourcesFolder) => {
      const directoryPath = normalize(join(__dirname, "..", "resources", staticResourcesFolder));
      const files = readdirSync(directoryPath);
      files.forEach((filename) => {
        const tokens = JSON.parse(readFileSync(join(__dirname, "..", "resources", staticResourcesFolder, filename)).toString()) as DocumentTokenizationResult;
        this.addDocument(this.initializeDocument(`${STATIC_PREFIX}/${filename.replace(".json", FILES_EXTENSION)}`, true, tokens));
      });
    });
  }

  public initializeDocument(uri: string, base: boolean, documentTokens: DocumentTokenizationResult) {
    // nwscript is implicit and selected per requesting workspace, even when an
    // include explicitly names it. Never resolve it through the basename index.
    const children = documentTokens.children.map((child, index) => ({ name: child.toLowerCase(), position: documentTokens.includePositions?.[index] })).filter((child) => child.name !== "nwscript");
    return new Document(
      base ? uri : normalizeDocumentUri(uri),
      base,
      children.map((child) => child.name),
      documentTokens.globalDeclarations,
      documentTokens.structDeclarations,
      children.map((child) => child.position),
      documentTokens.localDeclarations,
      documentTokens.memberReferences,
      documentTokens.entryPointDeclarations,
      this,
    );
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
    document: Document,
    getMatches: (candidate: Document) => ComplexToken[],
    implicitTokens: ComplexToken[] = [],
    insertionPosition: Position = { line: 0, character: 0 },
    referencePosition: Position = insertionPosition,
  ) {
    const included = new Set(document.getChildren());
    const entryPoints = new Set(document.entryPoints);
    for (const child of included) {
      const dependency = this.resolveInclude(child);
      dependency?.entryPoints.forEach((entryPoint) => entryPoints.add(entryPoint));
    }
    const conflicts = (source: Document | undefined) => source?.entryPoints.some((entryPoint) => entryPoints.has(entryPoint));
    const implicitDeclarations = new Set(implicitTokens);
    const currentDeclarations = new Set(document.globalDeclarations);
    const visible = new Map<string, ComplexToken[]>();
    const visibleTokens = new Set<ComplexToken>();
    const existingOrder = document.getDeclarationOrder();
    for (const token of [...existingOrder.keys(), ...implicitTokens]) {
      visibleTokens.add(token);
      visible.set(token.identifier, [...(visible.get(token.identifier) || []), token]);
    }
    const compareOrder = (left: number[], right: number[]) => {
      for (let index = 0; index < Math.min(left.length, right.length); index++) {
        if (left[index] !== right[index]) return left[index] - right[index];
      }
      return left.length - right.length;
    };
    const isScoped = (token: ComplexToken) =>
      token.tokenType === CompletionItemKind.Variable || token.tokenType === CompletionItemKind.TypeParameter || token.tokenType === CompletionItemKind.Property;
    const isReserved = (token: ComplexToken) =>
      token.tokenType === CompletionItemKind.Function || (token.tokenType === CompletionItemKind.Constant && (token.isConst || implicitDeclarations.has(token)));
    const declarationsConflict = (left: ComplexToken, right: ComplexToken, order: Map<ComplexToken, number[] | undefined>) => {
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
            (implicitDeclarations.has(other) || !knownOrder || earlier === other),
        );
      }
      if (isScoped(left) || isScoped(right)) {
        const scoped = isScoped(left) ? left : right;
        const other = scoped === left ? right : left;
        return Boolean(isReserved(other) && (implicitDeclarations.has(other) || !knownOrder || earlier === other));
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
        return other.tokenType !== CompletionItemKind.Constant || other.isConst === true || implicitDeclarations.has(other);
      }
      if (left.tokenType !== CompletionItemKind.Function || right.tokenType !== CompletionItemKind.Function) return true;
      // Engine API declarations already have implementations, despite prototype syntax.
      return (
        ((left.implementation || implicitDeclarations.has(left)) && (right.implementation || implicitDeclarations.has(right))) ||
        left.returnType !== right.returnType ||
        left.params.length !== right.params.length ||
        left.params.some((param, index) => param.valueType !== right.params[index].valueType)
      );
    };
    const getSafeMatches = (candidate: Document, matches: ComplexToken[]) => {
      const introduced = new Map<string, ComplexToken[]>();
      const incomingOrder = candidate.getDeclarationOrder();
      const order = new Map(existingOrder);
      for (const [token, path] of incomingOrder) {
        // The inserted include precedes an existing token at the same position.
        const incoming = path && [insertionPosition.line, insertionPosition.character, -1, ...path];
        const existing = order.get(token);
        order.set(token, incoming && existing ? (compareOrder(incoming, existing) < 0 ? incoming : existing) : incoming);
      }
      for (const token of incomingOrder.keys()) {
        if (visibleTokens.has(token)) {
          const before = existingOrder.get(token);
          const after = order.get(token);
          // Include-once dependencies can move earlier when reached through the
          // new helper. Recheck declarations whose effective position changes.
          if (!before || !after || compareOrder(after, before) >= 0) continue;
        }
        const prior = introduced.get(token.identifier) || [];
        if ([...(visible.get(token.identifier) || []), ...prior].some((existing) => existing !== token && declarationsConflict(existing, token, order))) return [];
        if (!visibleTokens.has(token)) introduced.set(token.identifier, [...prior, token]);
      }
      // Accepting a struct completion introduces a type use at the cursor,
      // which can be later than a legal same-named declaration in the script.
      const reference = [referencePosition.line, referencePosition.character, 1];
      const reservedNames = new Set(
        [...order.keys(), ...implicitTokens]
          .filter((token) => {
            const position = order.get(token);
            return isReserved(token) && (!position || compareOrder(position, reference) < 0);
          })
          .map((token) => token.identifier),
      );
      return matches.filter((token) => token.tokenType !== CompletionItemKind.Struct || !reservedNames.has(token.identifier));
    };
    const currentName = document.getIncludeName();
    const candidates: { document: Document; tokens: ComplexToken[] }[] = [];
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
      const tokens = getSafeMatches(candidate, matches);
      if (tokens.length) candidates.push({ document: candidate, tokens });
    });
    // Keep workspace symbols ahead of bundled symbols in bounded completion lists.
    return candidates.sort((left, right) => Number(left.document.base) - Number(right.document.base));
  }

  public createDocument(uri: string, documentTokens: DocumentTokenizationResult) {
    const document = this.initializeDocument(uri, false, documentTokens);
    if (isStandardLibrary(uri)) this.overwriteDocument(document);
    else this.addDocument(document);
  }

  public createDocuments(uri: string, content: string, tokenizer: Tokenizer, workespaceFilesSystem: WorkspaceFilesSystem) {
    const documentTokens = tokenizer.tokenizeContent(content, TokenizationMode.document);

    this.addDocument(this.initializeDocument(uri, false, documentTokens));
    this.createChildrenDocument(documentTokens.children, tokenizer, workespaceFilesSystem);
  }

  public updateDocument(document: TextDocument, tokenizer: Tokenizer, workespaceFilesSystem: WorkspaceFilesSystem) {
    // willSave and didSave can describe the same document version. Reuse its
    // tokens, but still retry missing includes that may have appeared on disk.
    const documentTokens = tokenizer.tokenizeDocument(document);

    this.overwriteDocument(this.initializeDocument(document.uri, false, documentTokens));
    // Already-declared includes may have failed indexing and since been repaired.
    // createChildrenDocument skips includes that are already available.
    this.createChildrenDocument(documentTokens.children, tokenizer, workespaceFilesSystem);
  }

  public debug(logger: Logger) {
    this.forEach((document) => document.debug(logger));
  }

  private addDocument(document: Document) {
    this.importChildren = new WeakMap();
    if (!document.base && !this.documentsByUri.has(document.uri)) this.documentsByUri.set(document.uri, document);
    this.add(document.getKey(), document);
  }

  private overwriteDocument(document: Document) {
    this.importChildren = new WeakMap();
    if (!document.base) this.documentsByUri.set(document.uri, document);
    // Updating a duplicate's own contents must not change include selection.
    const selected = this.get(document.getKey());
    if (!selected || selected.uri === document.uri) this.overwrite(document.getKey(), document);
  }

  private createChildrenDocument(children: string[], tokenizer: Tokenizer, workespaceFilesSystem: WorkspaceFilesSystem) {
    children.forEach((child) => {
      if (child.toLowerCase() === "nwscript" || this.get(child)) return;
      const filePath = workespaceFilesSystem.getFilePath(child);
      if (!filePath) return;

      const uri = pathToFileURL(filePath).href;
      if (this.get(this.getKey(uri, false))) return;

      const fileContent = readFileSync(filePath).toString();
      this.createDocuments(uri, fileContent, tokenizer, workespaceFilesSystem);
    });
  }
}
