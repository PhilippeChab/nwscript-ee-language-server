import { join } from "path";

import type { Tokenizer } from "../Tokenizer";
import type { ComplexToken } from "../Tokenizer/types";
import { GlobalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { Dictionnary } from "../Utils";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import Document from "./Document";
import { TextDocument } from "vscode-languageserver-textdocument";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  public readonly standardLibComplexTokens: ComplexToken[] = [];

  constructor() {
    super();

    this.standardLibComplexTokens = JSON.parse(
      WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "resources", "standardLibDefinitions.json")).toString()
    ).complexTokens as ComplexToken[];
  }

  private addDocument(document: Document) {
    this.add(document.getKey(), document);
  }

  private overwriteDocument(document: Document) {
    this.overwrite(document.getKey(), document);
  }

  private initializeDocument(filePath: string, globalScope: GlobalScopeTokenizationResult) {
    return new Document(filePath, globalScope.children, globalScope.complexTokens, globalScope.structComplexTokens, this);
  }

  public createDocument(filePath: string, globalScope: GlobalScopeTokenizationResult) {
    this.addDocument(this.initializeDocument(filePath, globalScope));
  }

  public updateDocument(document: TextDocument, tokenizer: Tokenizer) {
    const filePath = WorkspaceFilesSystem.fileUriToPath(document.uri);
    const globalScope = tokenizer.tokenizeContent(document.getText(), TokenizedScope.global);

    this.overwriteDocument(this.initializeDocument(filePath, globalScope));
  }
}
