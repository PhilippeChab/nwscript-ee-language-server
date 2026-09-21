import { CompletionList, CompletionParams } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { CompletionItemBuilder } from "./Builders";
import Provider from "./Provider";

const MAX_AUTO_IMPORT_ITEMS = 200;

export default class CompletionItemsProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onCompletion((params) => this.exceptionsWrapper(this.providerHandler(params)));
    this.server.connection.onCompletionResolve((item) => this.exceptionsWrapper(() => CompletionItemBuilder.buildResolvedItem(item, this.server.config), item));
  }

  private providerHandler(params: CompletionParams) {
    return () => {
      const {
        textDocument: { uri },
        position,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      if (!liveDocument) return;
      const document = this.getDocument(uri);
      if (!document) return;
      const { symbols, imports, autoImportContext } = document.semantic.getCompletions(position, this.server.config.completion.autoImport, MAX_AUTO_IMPORT_ITEMS);
      const items = symbols.map(({ declaration }) => CompletionItemBuilder.buildItem(declaration));
      if (autoImportContext) {
        items.push(...imports.map(({ declaration, includeName }) => CompletionItemBuilder.buildAutoImportItem(declaration, includeName, liveDocument, autoImportContext, this.server.config)));
      }
      // The client must request again when the typed prefix changes.
      return autoImportContext ? CompletionList.create(items, true) : items;
    };
  }
}
