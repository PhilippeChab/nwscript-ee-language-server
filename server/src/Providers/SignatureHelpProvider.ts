import { SignatureHelpParams } from "vscode-languageserver/node";

import type { ServerManager } from "../ServerManager";
import type { FunctionComplexToken } from "../Tokenizer/types";
import { LanguageScopes } from "../Tokenizer/constants";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
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
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const document = this.server.documentsCollection.getFromUri(uri);
      if (!liveDocument || !document) return;

      const [lines, rawTokenizedContent] = this.server.tokenizer.tokenizeContentToRaw(liveDocument.getText());
      const line = lines[position.line];
      const tokensArray = rawTokenizedContent[position.line];

      if (!tokensArray || !this.server.tokenizer.isInScope(tokensArray, position, LanguageScopes.functionCall)) return;

      const rawContent = this.server.tokenizer.getLookBehindScopesRawContent(line, tokensArray, position, [LanguageScopes.functionCall, LanguageScopes.functionIdentifier]);
      const activeParameter = this.server.tokenizer.getLookBehindScopeOccurences(tokensArray, position, LanguageScopes.separatorStatement, LanguageScopes.leftArgumentsRoundBracket);

      const localScope = this.server.tokenizer.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, position.line);
      const functionComplexToken =
        localScope.functionsComplexTokens.find((token) => token.identifier === rawContent) ||
        document.getGlobalComplexTokens().find((token) => token.identifier === rawContent) ||
        this.getStandardLibComplexTokens().find((token) => token.identifier === rawContent);

      if (functionComplexToken) {
        return SignatureHelpBuilder.buildFunctionItem(functionComplexToken as FunctionComplexToken, activeParameter);
      }
    };
  }
}
