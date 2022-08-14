import { basename, join } from "path";
import { readFileSync } from "fs";
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
    return basename(uri, FILES_EXTENSION).slice(0, -1);
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
}
