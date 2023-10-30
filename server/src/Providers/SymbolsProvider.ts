import { CompletionItemKind, DocumentSymbolParams } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { SymbolBuilder } from "./Builders";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import Provider from "./Provider";

export default class SymbolsProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onDocumentSymbol((params) => this.exceptionsWrapper(this.providerHandler(params)));
  }

  private providerHandler(params: DocumentSymbolParams) {
    return () => {
      const {
        textDocument: { uri },
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const document = this.server.documentsCollection.getFromUri(uri);
      if (!liveDocument || !document) return;

      const localScope = this.server.tokenizer.tokenizeContent(liveDocument.getText(), TokenizedScope.local);
      const constantSymbols = document.complexTokens.filter((token) => token.tokenType === CompletionItemKind.Constant).map((token) => SymbolBuilder.buildItem(token));
      const structSymbols = document.structComplexTokens.map((token) => SymbolBuilder.buildItem(token));

      return constantSymbols.concat(structSymbols.concat(localScope.functionsComplexTokens.map((token) => SymbolBuilder.buildItem(token))));
    };
  }
}
