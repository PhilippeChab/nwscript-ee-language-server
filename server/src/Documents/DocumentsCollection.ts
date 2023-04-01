import { basename, join, normalize } from "path";
import { readFileSync, readdirSync } from "fs";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { Tokenizer } from "../Tokenizer";
import type { ComplexToken } from "../Tokenizer/types";
import { GlobalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { Dictionnary } from "../Utils";
import Document from "./Document";
import { FILES_EXTENSION } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  public readonly standardLibComplexTokens: ComplexToken[] = [];

  constructor() {
    super();

    this.standardLibComplexTokens = JSON.parse(
      readFileSync(join(__dirname, "..", "resources", "standardLibDefinitions.json")).toString(),
    ).complexTokens as ComplexToken[];

    // const directoryPath = normalize(join(__dirname, "..", "resources", "base_scripts"));
    // const files = readdirSync(directoryPath);
    // files.forEach((filename) => {
    //   const tokens = readFileSync(
    //     join(__dirname, "..", "resources", "base_scripts", filename),
    //   ).toString() as any as GlobalScopeTokenizationResult;
    //   this.initializeDocument("", tokens);
    // });
  }

  private addDocument(document: Document) {
    this.add(document.getKey(), document);
  }

  private overwriteDocument(document: Document) {
    this.overwrite(document.getKey(), document);
  }

  private initializeDocument(uri: string, globalScope: GlobalScopeTokenizationResult) {
    return new Document(uri, globalScope.children, globalScope.complexTokens, globalScope.structComplexTokens, this);
  }

  public getKey(uri: string) {
    return basename(uri, FILES_EXTENSION);
  }

  public getFromUri(uri: string) {
    return this.get(this.getKey(uri));
  }

  public createDocument(uri: string, globalScope: GlobalScopeTokenizationResult) {
    this.addDocument(this.initializeDocument(uri, globalScope));
  }

  public updateDocument(document: TextDocument, tokenizer: Tokenizer) {
    const globalScope = tokenizer.tokenizeContent(document.getText(), TokenizedScope.global);

    this.overwriteDocument(this.initializeDocument(document.uri, globalScope));
  }

  public debug() {
    this.forEach((document) => document.debug());
  }
}
