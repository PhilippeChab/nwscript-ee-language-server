import type { OwnedComplexTokens } from "../Documents/Document";
import type { ServerManager } from "../ServerManager";
import type { ComplexToken } from "../Tokenizer/types";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
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

      if (liveDocument) {
        let token: ComplexToken | undefined;
        let ref: OwnedComplexTokens | undefined;
        const identifier = this.server.tokenizer?.findActionTargetIdentifier(liveDocument.getText(), position);

        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, position.line);
        token = localScope?.functionsComplexTokens.find((token) => token.data.identifier === identifier);

        if (document) {
          if (!token) {
            const tokensWithRef = document.getGlobalStructComplexTokensWithRef();
            for (let i = 0; i < tokensWithRef.length; i++) {
              ref = tokensWithRef[i];

              token = ref.tokens.find((token) => token.data.identifier === identifier);
              if (token) {
                break;
              }
            }
          }

          if (!token) {
            const tokensWithRef = document.getGlobalComplexTokensWithRef();
            for (let i = 0; i < tokensWithRef.length; i++) {
              ref = tokensWithRef[i];

              token = ref.tokens.find((token) => token.data.identifier === identifier);
              if (token) {
                break;
              }
            }
          }
        }

        if (token) {
          return {
            uri: ref ? WorkspaceFilesSystem.filePathToUri(ref.owner).toString() : uri,
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
