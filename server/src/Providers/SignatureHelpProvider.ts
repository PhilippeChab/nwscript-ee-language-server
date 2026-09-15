import { SignatureHelpParams } from "vscode-languageserver/node";

import type { ServerManager } from "../ServerManager";
import type { FunctionComplexToken } from "../Tokenizer/types";
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

      const context = this.getDocumentContext(uri, position);
      if (!context) return;
      const { document, localScope, lines, rawTokenizedContent } = context;
      const call = this.server.tokenizer.getCallContextFromRaw(lines, rawTokenizedContent, position);
      if (!call) return;
      const { identifier: rawContent, activeParameter } = call;
      const functionComplexToken =
        localScope.functionsComplexTokens.find((token) => token.identifier === rawContent) ||
        document.getGlobalComplexTokens().find((token) => token.identifier === rawContent) ||
        this.getStandardLibComplexTokens(uri).find((token) => token.identifier === rawContent);

      if (functionComplexToken) {
        return SignatureHelpBuilder.buildFunctionItem(functionComplexToken as FunctionComplexToken, activeParameter);
      }
    };
  }
}
