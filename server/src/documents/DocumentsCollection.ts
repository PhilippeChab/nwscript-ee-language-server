import { each } from "async";
import { fileURLToPath } from "url";

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

  private overwriteDocument(document: Document) {
    this.overwrite(document.getKey(), document);
  }

  private initializeDocument(filePath: string, tokenizer: Tokenizer) {
    const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();

    const globalDefinitions = tokenizer.retrieveGlobalDefinitions(fileContent);

    return new Document(filePath, globalDefinitions.children, globalDefinitions.structures, {
      globalItems: globalDefinitions.items,
      localItems: [],
    });
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
