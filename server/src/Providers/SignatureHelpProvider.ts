import { SignatureHelpParams } from "vscode-languageserver/node";

import type { ServerManager } from "../ServerManager";
import type { ComplexToken, FunctionComplexToken } from "../Tokenizer/types";
import { LanguageScopes } from "../Tokenizer/constants";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { SignatureHelpBuilder } from "./Builders";
import Provider from "./Provider";

export default class SignatureHelpProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onSignatureHelp((params) => this.exceptionsWrapper(this.providerHandler(params)));
  }

  private providerHandler(params: SignatureHelpParams) {
    return () => {
      const {
        textDocument: { uri },
        position,
        context,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const path = WorkspaceFilesSystem.fileUriToPath(uri);
      const documentKey = WorkspaceFilesSystem.getFileBasename(path);
      const document = this.server.documentsCollection?.get(documentKey);

      let functionComplexToken: ComplexToken | undefined;
      if (liveDocument) {
        const tokenizedResult = this.server.tokenizer?.isInLanguageScope(
          liveDocument.getText(),
          position,
          LanguageScopes.functionCall
        );
        if (!tokenizedResult) {
          return undefined;
        }

        const functionIdentifier = this.server.tokenizer?.findIdentiferFromPositionForLanguageScopes(
          tokenizedResult.line,
          tokenizedResult.tokensArray,
          position,
          [LanguageScopes.functionCall, LanguageScopes.functionIdentifier]
        );
        const activeParameter = this.server.tokenizer?.getLanguageScopeOccurencesFromPositionWithDelimiter(
          tokenizedResult.tokensArray,
          position,
          LanguageScopes.separatorStatement,
          LanguageScopes.leftArgumentsRoundBracket
        );

        if (context?.isRetrigger && context.activeSignatureHelp) {
          const { activeSignature, signatures } = context?.activeSignatureHelp;

          if (
            activeSignature &&
            functionIdentifier ===
              this.server.tokenizer?.findFirstIdentiferForLanguageScope(
                signatures[activeSignature].label,
                LanguageScopes.functionIdentifier
              )
          ) {
            return {
              signatures,
              activeSignature,
              activeParameter: activeParameter || null,
            };
          }
        }

        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, position.line);

        if (localScope) {
          functionComplexToken = localScope.functionsComplexTokens.find((token) => token.identifier === functionIdentifier);

          if (document) {
            if (!functionComplexToken) {
              functionComplexToken = document.getGlobalComplexTokens().find((token) => token.identifier === functionIdentifier);
            }

            if (!functionComplexToken) {
              functionComplexToken = this.getStandardLibComplexTokens().find((token) => token.identifier === functionIdentifier);
            }
          }
        }

        if (functionComplexToken) {
          return SignatureHelpBuilder.buildFunctionItem(functionComplexToken as FunctionComplexToken, activeParameter);
        }
      }
    };
  }
}
