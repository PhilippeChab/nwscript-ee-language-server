import { join } from "path";

import type { Tokenizer } from "../Tokenizer";
import type { ComplexToken } from "../Tokenizer/types";
import { GlobalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { Dictionnary } from "../Utils";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import Document from "./Document";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  public readonly standardLibComplexTokens: ComplexToken[] = [];

  constructor() {
    super();

    this.standardLibComplexTokens = JSON.parse(
      WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "..", "resources", "standardLibDefinitions.json")).toString()
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

  public initialize(documentsIndexerResult: { filePath: string; globalScope: GlobalScopeTokenizationResult }[]) {
    documentsIndexerResult.forEach((result) => {
      this.addDocument(this.initializeDocument(result.filePath, result.globalScope));
    });
  }

  public async updateDocument(uri: string, tokenizer: Tokenizer) {
    const filePath = WorkspaceFilesSystem.fileUriToPath(uri);
    const fileContent = (await WorkspaceFilesSystem.readFileAsync(filePath)).toString();
    const globalScope = tokenizer.tokenizeContent(fileContent, TokenizedScope.global);

    this.overwriteDocument(this.initializeDocument(filePath, globalScope));
  }
}