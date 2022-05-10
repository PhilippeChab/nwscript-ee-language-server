import { each } from "async";
import { CompletionItem, CompletionItemKind } from "vscode-languageserver";

import { connection, workspaceFilesManager } from "../server";
import Tokenizer from "../tokenizer/Tokenizer";
import Tokeniser from "../tokenizer/Tokenizer";
import { Dictionnary } from "../utils";
import { WorkspaceFilesSystem } from "../workspaceFiles";
import Document from "./Document";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  initialize = async () => {
    const filePaths = workspaceFilesManager.getAllFilePaths();
    const tokenizer = await new Tokenizer().loadGrammar();

    await each(filePaths, async (filePath) => {
      const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();

      // const tokens = await Tokeniser(fileContent);
      const includes = WorkspaceFilesSystem.getFileIncludes(fileContent);
      const tokens = tokenizer.tokenizeContent(fileContent);
      const constants = tokenizer.retrieveConstants(tokens);

      // TODO: Get definitions
      const definitions: CompletionItem[] = constants.map((constant) => {
        return {
          label: constant,
          kind: CompletionItemKind.Constant,
        };
      });

      const document = new Document(filePath, includes, definitions);

      // Skipping duplicates, too bad for ya! :D
      if (!this.exist(document.getKey())) {
        this.addDocument(document);
      }
    });

    this.debug();

    return this;
  };

  getCompletionItems = (uri: string) => {
    const path = WorkspaceFilesSystem.fileUriToPath(uri);

    const documentKey = WorkspaceFilesSystem.getFileBasename(path);

    return this.get(documentKey).definitions;
  };

  private addDocument = (document: Document) => {
    this.add(document.getKey(), document);
  };

  private debug = () => {
    this.forEach((document) => {
      connection.console.info("------------");
      connection.console.info(`Document key: ${document.getKey()}`);
      connection.console.info(`Document path: ${document.path}`);
      connection.console.info(`Document children:`);
      document.children.forEach((child, index) => connection.console.info(`${index}. ${child}`));
      connection.console.info(`Document definitions:`);
      document.definitions.forEach((definition, index) => connection.console.info(`${index}. ${definition.label}`));
      connection.console.info("------------");
    });
  };
}
