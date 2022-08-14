import { CompletionItemKind, DefinitionParams } from "vscode-languageserver";

import type { OwnedComplexTokens, OwnedStructComplexTokens } from "../Documents/Document";
import type { ServerManager } from "../ServerManager";
import type { ComplexToken } from "../Tokenizer/types";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import Provider from "./Provider";

export default class GotoDefinitionProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onDefinition((params) => this.exceptionsWrapper(this.providerHandler(params)));
  }

  private providerHandler(params: DefinitionParams) {
    return () => {
      const {
        textDocument: { uri },
        position,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const document = this.server.documentsCollection.getFromUri(uri);

      if (liveDocument && this.server.tokenizer) {
        let token: ComplexToken | undefined;
        let ref: OwnedComplexTokens | OwnedStructComplexTokens | undefined;
        const { tokenType, structVariableIdentifier, identifier } = this.server.tokenizer.findActionTargetAtPosition(
          liveDocument.getText(),
          position,
        );

        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, position.line);

        if (!tokenType) {
          token = localScope?.functionVariablesComplexTokens.find((token) => token.identifier === identifier);
        }

        if (!token && tokenType === CompletionItemKind.Function) {
          token = localScope?.functionsComplexTokens.find((token) => token.identifier === identifier);
        }

        if (document) {
          if (tokenType === CompletionItemKind.Property && structVariableIdentifier) {
            const structIdentifer = localScope?.functionVariablesComplexTokens.find(
              (token) => token.identifier === structVariableIdentifier,
            )?.valueType;

            const tokensWithRef = document.getGlobalStructComplexTokensWithRef();
            for (let i = 0; i < tokensWithRef.length; i++) {
              ref = tokensWithRef[i];

              token = (ref as OwnedStructComplexTokens).tokens
                .find((token) => token.identifier === structIdentifer)
                ?.properties.find((property) => property.identifier === identifier);

              if (token) {
                break;
              }
            }
          }

          if (!token && tokenType === CompletionItemKind.Struct) {
            const tokensWithRef = document.getGlobalStructComplexTokensWithRef();
            for (let i = 0; i < tokensWithRef.length; i++) {
              ref = tokensWithRef[i];

              token = ref.tokens.find((token) => token.identifier === identifier);
              if (token) {
                break;
              }
            }
          }

          if (!token && (tokenType === CompletionItemKind.Constant || tokenType === CompletionItemKind.Function)) {
            const tokensWithRef = document.getGlobalComplexTokensWithRef();
            for (let i = 0; i < tokensWithRef.length; i++) {
              ref = tokensWithRef[i];

              token = ref.tokens.find((token) => token.identifier === identifier);
              if (token) {
                break;
              }
            }
          }
        }

        if (token) {
          return {
            uri: ref ? ref.owner : uri,
            range: {
              start: { line: token.position.line, character: token.position.character },
              end: { line: token.position.line, character: token.position.character },
            },
          };
        }
      }

      return undefined;
    };
  }
}
