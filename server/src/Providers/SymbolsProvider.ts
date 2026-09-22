import { DocumentSymbolParams, DocumentSymbol, SymbolInformation } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { SymbolBuilder } from "./Builders";
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

      const document = this.getDocument(uri);
      if (!document) return;
      const symbols = document.semantic.getDocumentDeclarations().map((declaration) => SymbolBuilder.buildItem(declaration));
      if (this.server.capabilitiesHandler.getSupportsHierarchicalSymbols()) return symbols;
      const flatten = (items: DocumentSymbol[], containerName?: string): SymbolInformation[] =>
        items.flatMap((item) => [{ name: item.name, kind: item.kind, location: { uri, range: item.selectionRange }, containerName }, ...flatten(item.children || [], item.name)]);
      return flatten(symbols);
    };
  }
}
