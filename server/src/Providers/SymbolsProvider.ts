import { CompletionItemKind, DocumentSymbolParams, DocumentSymbol, SymbolInformation } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { isStandardLibrary } from "../Documents/StandardLibrary";
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

      const context = this.getDocumentContext(uri);
      if (!context) return;
      const { document, localScope } = context;
      const constantSymbols = document.globalDeclarations
        .filter((declaration) => declaration.kind === CompletionItemKind.Constant)
        .map((declaration) => SymbolBuilder.buildItem(declaration, isStandardLibrary(uri)));
      const structSymbols = document.structDeclarations.map((declaration) => SymbolBuilder.buildItem(declaration));

      const implementations = new Set(localScope.functionDeclarations.map((declaration) => declaration.identifier));
      const prototypes = document.globalDeclarations.filter((declaration) => declaration.kind === CompletionItemKind.Function && !implementations.has(declaration.identifier));
      const functions = [...localScope.functionDeclarations, ...prototypes].map((declaration) => SymbolBuilder.buildItem(declaration));
      const symbols = constantSymbols.concat(structSymbols, functions);
      if (this.server.capabilitiesHandler.getSupportsHierarchicalSymbols()) return symbols;
      const flatten = (items: DocumentSymbol[], containerName?: string): SymbolInformation[] =>
        items.flatMap((item) => [{ name: item.name, kind: item.kind, location: { uri, range: item.selectionRange }, containerName }, ...flatten(item.children || [], item.name)]);
      return flatten(symbols);
    };
  }
}
