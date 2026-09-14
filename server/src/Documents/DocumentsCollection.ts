import { basename, join, normalize } from "path";
import { readFileSync, readdirSync } from "fs";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { Tokenizer } from "../Tokenizer";
import { GlobalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { Dictionnary } from "../Utils";
import Document from "./Document";
import WorkspaceFilesSystem, { FILES_EXTENSION } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";
import { isStandardLibrary } from "./StandardLibrary";

const STATIC_RESOURCES_FOLDERS = ["base_scripts", "ovr"];
export const STATIC_PREFIX = "static";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  // Requests identify an exact document; basename lookup is only for includes.
  private readonly documentsByUri = new Map<string, Document>();
  private readonly liveScopes = new WeakMap<TextDocument, { version: number; scope: GlobalScopeTokenizationResult }>();

  constructor() {
    super();

    STATIC_RESOURCES_FOLDERS.forEach((staticResourcesFolder) => {
      const directoryPath = normalize(join(__dirname, "..", "resources", staticResourcesFolder));
      const files = readdirSync(directoryPath);
      files.forEach((filename) => {
        const tokens = JSON.parse(readFileSync(join(__dirname, "..", "resources", staticResourcesFolder, filename)).toString()) as GlobalScopeTokenizationResult;
        this.addDocument(this.initializeDocument(`${STATIC_PREFIX}/${filename.replace(".json", FILES_EXTENSION)}`, true, tokens));
      });
    });
  }

  private addDocument(document: Document) {
    if (!document.base && !this.documentsByUri.has(document.uri)) this.documentsByUri.set(document.uri, document);
    this.add(document.getKey(), document);
  }

  private overwriteDocument(document: Document) {
    if (!document.base) this.documentsByUri.set(document.uri, document);
    // Updating a duplicate's own contents must not change include selection.
    const selected = this.get(document.getKey());
    if (!selected || selected.uri === document.uri) this.overwrite(document.getKey(), document);
  }

  private initializeDocument(uri: string, base: boolean, globalScope: GlobalScopeTokenizationResult) {
    // nwscript is implicit and selected per requesting workspace, even when an
    // include explicitly names it. Never resolve it through the basename index.
    return new Document(
      uri,
      base,
      globalScope.children.filter((child) => child.toLowerCase() !== "nwscript"),
      globalScope.complexTokens,
      globalScope.structComplexTokens,
      this,
    );
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

  public getKey(uri: string, base: boolean) {
    if (base) {
      return uri.replace(FILES_EXTENSION, "");
    }

    return basename(uri, FILES_EXTENSION);
  }

  public getFromUri(uri: string) {
    return this.documentsByUri.get(uri);
  }

  public getImportableDocuments(document: Document) {
    const included = new Set(document.getChildren());
    const currentName = document.getIncludeName();
    const candidates: Document[] = [];
    this.forEach((candidate) => {
      const name = candidate.getIncludeName();
      if (name === currentName || name.toLowerCase() === "nwscript" || included.has(name)) return;
      if (['"', "\r", "\n", "\\"].some((character) => name.includes(character))) return;
      // Use the same workspace-over-bundled selection as include resolution.
      if (candidate.base && this.get(name)) return;
      if (candidate.getChildren().includes(currentName)) return;
      candidates.push(candidate);
    });
    return candidates;
  }

  public createDocument(uri: string, globalScope: GlobalScopeTokenizationResult) {
    const document = this.initializeDocument(uri, false, globalScope);
    if (isStandardLibrary(uri)) this.overwriteDocument(document);
    else this.addDocument(document);
  }

  public createDocuments(uri: string, content: string, tokenizer: Tokenizer, workespaceFilesSystem: WorkspaceFilesSystem) {
    const globalScope = tokenizer.tokenizeContent(content, TokenizedScope.global);

    this.addDocument(this.initializeDocument(uri, false, globalScope));
    this.createChildrenDocument(globalScope.children, tokenizer, workespaceFilesSystem);
  }

  public updateDocument(document: TextDocument, tokenizer: Tokenizer, workespaceFilesSystem: WorkspaceFilesSystem) {
    // willSave and didSave can describe the same document version. Reuse its
    // tokens, but still retry missing includes that may have appeared on disk.
    const cached = this.liveScopes.get(document);
    const globalScope = cached?.version === document.version ? cached.scope : tokenizer.tokenizeContent(document.getText(), TokenizedScope.global);
    this.liveScopes.set(document, { version: document.version, scope: globalScope });

    this.overwriteDocument(this.initializeDocument(document.uri, false, globalScope));
    // Already-declared includes may have failed indexing and since been repaired.
    // createChildrenDocument skips includes that are already available.
    this.createChildrenDocument(globalScope.children, tokenizer, workespaceFilesSystem);
  }

  public debug() {
    this.forEach((document) => document.debug());
  }
}
