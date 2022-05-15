import { Location, Range } from "vscode-languageserver";
import { ServerManager } from "../ServerManager";
import { ComplexToken } from "../Tokenizer/types";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import Provider from "./Provider";

export default class GotoDefinitionProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onDefinition((params) => {
      const {
        textDocument: { uri },
        position,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const path = WorkspaceFilesSystem.fileUriToPath(uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);
      const document = this.server.documentsCollection?.get(documentKey);

      if (liveDocument && document) {
        const identifier = this.server.tokenizer?.findActionTargetIdentifier(liveDocument.getText(), position);
        const token = document.complexTokens.find((token) => token.data.identifier === identifier);

        if (token) {
          return {
            uri: uri,
            range: {
              start: { line: token.position.line, character: token.position.character },
              end: { line: token.position.line, character: token.position.character },
            },
          };
        }
      }

      return undefined;
    });
  }
}
