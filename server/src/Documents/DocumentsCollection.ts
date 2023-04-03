import { basename, join, normalize } from "path";
import { readFileSync, readdirSync } from "fs";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { Tokenizer } from "../Tokenizer";
import type { ComplexToken } from "../Tokenizer/types";
import { GlobalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { Dictionnary } from "../Utils";
import Document from "./Document";
import WorkspaceFilesSystem, { FILES_EXTENSION } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";

const STATIC_RESOURCES_FOLDERS = ["base_scripts", "ovr"];
export const STATIC_PREFIX = "static";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  public readonly standardLibComplexTokens: ComplexToken[] = [];

  constructor() {
    super();

    this.standardLibComplexTokens = JSON.parse(
      readFileSync(join(__dirname, "..", "resources", "standardLibDefinitions.json")).toString(),
    ).complexTokens as ComplexToken[];

    STATIC_RESOURCES_FOLDERS.forEach((static_resources_folder) => {
      const directoryPath = normalize(join(__dirname, "..", "resources", static_resources_folder));
      const files = readdirSync(directoryPath);
      files.forEach((filename) => {
        const tokens = JSON.parse(
          readFileSync(join(__dirname, "..", "resources", static_resources_folder, filename)).toString(),
        ) as any as GlobalScopeTokenizationResult;
        this.addDocument(this.initializeDocument(`${STATIC_PREFIX}/${filename.replace(".json", FILES_EXTENSION)}`, true, tokens));
      });
    });
  }

  private addDocument(document: Document) {
    this.add(document.getKey(), document);
  }

  private overwriteDocument(document: Document) {
    this.overwrite(document.getKey(), document);
  }

  private initializeDocument(uri: string, base: boolean, globalScope: GlobalScopeTokenizationResult) {
    return new Document(uri, base, globalScope.children, globalScope.complexTokens, globalScope.structComplexTokens, this);
  }

  private createChildrenDocument(children: string[], tokenizer: Tokenizer, workespaceFilesSystem: WorkspaceFilesSystem) {
    children.forEach((child) => {
      const filePath = workespaceFilesSystem.getFilePath(child);
      if (!filePath) return;

      const uri = pathToFileURL(filePath).href;
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
    return this.get(this.getKey(uri, false));
  }

  public createDocument(uri: string, globalScope: GlobalScopeTokenizationResult) {
    this.addDocument(this.initializeDocument(uri, false, globalScope));
  }

  public createDocuments(uri: string, content: string, tokenizer: Tokenizer, workespaceFilesSystem: WorkspaceFilesSystem) {
    const globalScope = tokenizer.tokenizeContent(content, TokenizedScope.global);

    this.addDocument(this.initializeDocument(uri, false, globalScope));
    this.createChildrenDocument(globalScope.children, tokenizer, workespaceFilesSystem);
  }

  public updateDocument(document: TextDocument, tokenizer: Tokenizer, workespaceFilesSystem: WorkspaceFilesSystem) {
    const currentChildren = this.getFromUri(document.uri)?.children;
    const globalScope = tokenizer.tokenizeContent(document.getText(), TokenizedScope.global);
    const newChildren = globalScope.children.filter((child) => !currentChildren!.includes(child));

    this.overwriteDocument(this.initializeDocument(document.uri, false, globalScope));
    this.createChildrenDocument(newChildren, tokenizer, workespaceFilesSystem);
  }

  public debug() {
    this.forEach((document) => document.debug());
  }
}
