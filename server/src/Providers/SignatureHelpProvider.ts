import { CompletionItemKind, SignatureHelpParams } from "vscode-languageserver/node";

import type { ServerManager } from "../ServerManager";
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
      const { syntax } = context.document;
      if (!syntax) return;
      const call = syntax.getCallContext(position);
      if (!call) return;
      const { identifier: rawContent, activeParameter } = call;
      const functionDeclaration = this.resolveValue(context, rawContent)?.declaration;
      if (functionDeclaration?.tokenType === CompletionItemKind.Function) {
        return SignatureHelpBuilder.buildFunctionItem(functionDeclaration, activeParameter);
      }
    };
  }
}
