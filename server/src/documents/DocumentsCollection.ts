import { each } from "async";
import { CompletionItem } from "vscode-languageserver";

import { connection, workspaceFilesManager } from "../server";
import Tokeniser from "../tokenizer/Tokenizer";
import { Dictionnary } from "../utils";
import { WorkspaceFilesSystem } from "../workspaceFiles";
import Document from "./Document";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  initialize = async () => {
    const filePaths = workspaceFilesManager.getAllFilePaths();

    await each(filePaths, async (filePath) => {
      const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();

      // const tokens = await Tokeniser(fileContent);
      const includes = WorkspaceFilesSystem.getFileIncludes(fileContent);

      // TODO: Get definitions
      const definitions: CompletionItem[] = [];

      const document = new Document(filePath, includes, definitions);

      // Skipping duplicates, too bad for ya! :D
      if (!this.exist(document.getKey())) {
        this.addDocument(document);
      }
    });

    this.debug();

    return this;
  };

  addDocument = (document: Document) => {
    this.add(document.getKey(), document);
  };

  private debug = () => {
    this.forEach((document) => {
      connection.console.info("------------");
      connection.console.info(`Document key: ${document.getKey()}`);
      connection.console.info(`Document path: ${document.path}`);
      connection.console.info(`Document children:`);
      document.children.forEach((child, index) => connection.console.info(`${index}. ${child}`));
      connection.console.info("------------");
    });
  };
}
