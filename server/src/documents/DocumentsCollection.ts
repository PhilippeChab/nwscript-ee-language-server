import { each } from "async";

import { logger, workspaceFilesManager } from "../server";
import { Tokenizer } from "../tokenizer";
import { Dictionnary } from "../utils";
import { WorkspaceFilesSystem } from "../workspaceFiles";
import Document from "./Document";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  private debug() {
    this.forEach((document) => {
      logger.info("------------");
      logger.info(`Document key: ${document.getKey()}`);
      logger.info(`Document path: ${document.path}`);
      logger.info(`Document children:`);
      document.children.forEach((child, index) => logger.info(`${index}. ${child}`));
      logger.info(`Document definitions:`);
      document.definitions.globalItems.forEach((definition, index) => logger.info(`${index}. ${definition.label}`));
      logger.info("------------");
    });
  }

  private addDocument(document: Document) {
    this.add(document.getKey(), document);
  }

  async initialize() {
    const filePaths = workspaceFilesManager.getAllFilePaths();
    const tokenizer = await new Tokenizer().loadGrammar();

    await each(filePaths, async (filePath) => {
      const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();

      const globalDefinitions = tokenizer.retrieveGlobalDefinitions(fileContent);

      const document = new Document(filePath, globalDefinitions.children, {
        globalItems: globalDefinitions.items,
        localItems: [],
      });

      // Skipping duplicates, too bad for ya! :D
      if (!this.exist(document.getKey())) {
        this.addDocument(document);
      }
    });

    return this;
  }
}
