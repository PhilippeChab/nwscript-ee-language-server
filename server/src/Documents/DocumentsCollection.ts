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
    this.overwrite(document.getKey(), document);
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
      if (child.toLowerCase() === "nwscript") return;
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
    const currentChildren = this.getFromUri(document.uri)?.children;
    const globalScope = tokenizer.tokenizeContent(document.getText(), TokenizedScope.global);
    const newChildren = globalScope.children.filter((child) => !currentChildren?.includes(child));

    this.overwriteDocument(this.initializeDocument(document.uri, false, globalScope));
    this.createChildrenDocument(newChildren, tokenizer, workespaceFilesSystem);
  }

  public debug() {
    this.forEach((document) => document.debug());
  }
}
