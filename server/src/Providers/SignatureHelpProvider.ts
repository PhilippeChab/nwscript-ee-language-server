import { SignatureHelpParams } from "vscode-languageserver/node";

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

      const call = this.getDocument(uri)?.semantic.resolveCall(position);
      if (!call) return;
      const {
        symbol: { declaration: functionDeclaration },
        activeParameter,
      } = call;
      return SignatureHelpBuilder.buildFunctionItem(functionDeclaration, activeParameter);
    };
  }
}
