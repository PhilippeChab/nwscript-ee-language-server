import { each } from "async";
import { fileURLToPath } from "url";

import type { Logger } from "../Logger";
import type { Tokenizer } from "../Tokenizer";
import { TokenizeScope } from "../tokenizer/Tokenizer";
import { Dictionnary } from "../Utils";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import Document from "./Document";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  private addDocument(document: Document) {
    this.add(document.getKey(), document);
  }

  private overwriteDocument(document: Document) {
    this.overwrite(document.getKey(), document);
  }

  private initializeDocument(filePath: string, tokenizer: Tokenizer) {
    const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();

    const globalScope = tokenizer.tokenizeContent(fileContent, TokenizeScope.global);

    return new Document(filePath, globalScope.children, globalScope.complexTokens, globalScope.structComplexTokens);
  }

  async initialize(workspaceFilesSystem: WorkspaceFilesSystem, tokenizer: Tokenizer) {
    const filePaths = workspaceFilesSystem.getAllFilePaths();
    filePaths.forEach((filePath) => {
      this.addDocument(this.initializeDocument(filePath, tokenizer));
    });

    return this;
  }

  public updateDocument(uri: string, tokenizer: Tokenizer) {
    const filePath = WorkspaceFilesSystem.fileUriToPath(uri);
    this.overwriteDocument(this.initializeDocument(filePath, tokenizer));
  }
}
