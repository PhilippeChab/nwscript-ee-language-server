import { MarkedString, MarkupKind } from "vscode-languageserver";
import type { ServerManager } from "../ServerManager";
import type { ComplexToken } from "../Tokenizer/types";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import Provider from "./Provider";
import { HoverContentBuilder } from "./Builders";
import { DocumentsCollection } from "../Documents";

export default class HoverContentProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onHover((params) => {
      const {
        textDocument: { uri },
        position,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const path = WorkspaceFilesSystem.fileUriToPath(uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);
      const document = this.server.documentsCollection?.get(documentKey);

      if (liveDocument) {
        let token: ComplexToken | undefined;
        const identifier = this.server.tokenizer?.findActionTargetIdentifier(liveDocument.getText(), position);

        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, position.line);
        token = localScope?.functionsComplexTokens.find((token) => token.data.identifier === identifier);

        if (!token) {
          token = localScope?.functionVariablesComplexTokens.find((token) => token.data.identifier === identifier);
        }

        if (document) {
          if (!token) {
            const tokens = document.getGlobalStructComplexTokens();
            token = tokens.find((token) => token.data.identifier === identifier);
          }

          if (!token) {
            const tokens = document.getGlobalComplexTokens();
            token = tokens.find((token) => token.data.identifier === identifier);
          }

          if (!token && this.server.documentsCollection) {
            const tokens = this.server.documentsCollection.standardLibComplexTokens;
            token = tokens.find((token) => token.data.identifier === identifier);
          }
        }

        if (token) {
          return {
            contents: HoverContentBuilder.buildItem(token),
          };
        }
      }

      return undefined;
    });
  }
}
