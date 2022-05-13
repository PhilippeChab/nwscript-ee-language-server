import { each } from "async";

import type { Logger } from "../Logger";
import type { Tokenizer } from "../Tokenizer";
import { Dictionnary } from "../Utils";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import Document from "./Document";

export default class DocumentsCollection extends Dictionnary<string, Document> {
  private debug(logger: Logger) {
    this.forEach((document) => {
      logger.info("------------");
      logger.info(`Document key: ${document.getKey()}`);
      logger.info(`Document path: ${document.path}`);
      logger.info(`Document children:`);
      document.children.forEach((child, index) => logger.info(`${index}. ${child}`));
      logger.info(`Document structures:`);
      document.structures.forEach((child, index) =>
        logger.info(
          `${index}. ${child.label}: ${Object.entries(child.properties).map((property) => `(${property[1]}) ${property[0]}`)}`
        )
      );
      logger.info(`Document definitions:`);
      document.definitions.globalItems.forEach((definition, index) => logger.info(`${index}. ${definition.label}`));
      logger.info("------------");
    });
  }

  private addDocument(document: Document) {
    this.add(document.getKey(), document);
  }

  async initialize(workspaceFilesSystem: WorkspaceFilesSystem, tokenizer: Tokenizer) {
    const filePaths = workspaceFilesSystem.getAllFilePaths();
    await each(filePaths, async (filePath) => {
      const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();

      const globalDefinitions = tokenizer.retrieveGlobalDefinitions(fileContent);

      const document = new Document(filePath, globalDefinitions.children, globalDefinitions.structures, {
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
