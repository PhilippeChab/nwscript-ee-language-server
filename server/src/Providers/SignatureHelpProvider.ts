import type { ServerManager } from "../ServerManager";
import { TriggerCharacters } from ".";
import { LanguageTypes } from "../Tokenizer/constants";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import { ComplexToken } from "../Tokenizer/types";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { SignatureHelpBuilder } from "./Builders";
import Provider from "./Provider";

export default class SignatureHelpProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onSignatureHelp((params) => {
      const {
        textDocument: { uri },
        position,
        context,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const path = WorkspaceFilesSystem.fileUriToPath(uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);
      const document = this.server.documentsCollection?.get(documentKey);
      this.server.logger.info(JSON.stringify(params.context));

      let functionIdentifier: string | undefined;
      let functionComplexToken: ComplexToken | undefined;
      if (liveDocument) {
        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, position.line);

        if (localScope) {
          if (document) {
            // And same label
            // And still in function parameters
            if (context?.isRetrigger && context.activeSignatureHelp) {
              const { activeSignature, signatures } = context?.activeSignatureHelp;
              let activeParameter = context.activeSignatureHelp?.activeParameter;
              if (typeof activeParameter === "number" && context?.triggerCharacter === TriggerCharacters.comma) {
                activeParameter++;
              }

              return {
                signatures,
                activeSignature,
                activeParameter,
              };
            }

            if (params.context?.triggerCharacter === TriggerCharacters.leftRoundBracket) {
              functionIdentifier = this.server.tokenizer?.findLineIdentiferAt(liveDocument.getText(), position, -2);
              functionIdentifier =
                functionIdentifier === TriggerCharacters.leftRoundBracket
                  ? this.server.tokenizer?.findLineIdentiferAt(liveDocument.getText(), position, -3)
                  : functionIdentifier;
            }
            // Comma and in function parameters?

            functionComplexToken = localScope.functionsComplexTokens.find((token) => token.identifier === functionIdentifier);

            if (!functionComplexToken) {
              functionComplexToken = document.getGlobalComplexTokens().find((token) => token.identifier === functionIdentifier);
            }

            if (!functionComplexToken) {
              functionComplexToken = this.getStandardLibComplexTokens().find((token) => token.identifier === functionIdentifier);
            }

            if (functionComplexToken) {
              return SignatureHelpBuilder.buildItem(functionComplexToken, context?.activeSignatureHelp);
            }
          }
        }
      }
    });
  }
}
