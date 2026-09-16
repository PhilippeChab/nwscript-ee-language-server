import { CompletionItem, CompletionList, CompletionParams } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { ServerManager } from "../ServerManager";
import { CompletionItemBuilder } from "./Builders";
import { AutoImportContext, LocalScope } from "../Parser/ParserService";
import { IndexedDocument } from "../Documents";
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

      const context = this.getDocumentContext(uri, position);
      if (!context) return;
      const { liveDocument, document, localScope } = context;
      const { syntax } = document;
      if (syntax.isInCommentOrString(position)) return [];
      const completionContext = syntax.getAutoImportContext(position);
      const autoImportContext = this.server.config.completion.autoImport ? completionContext : undefined;

      const memberPath = syntax.getMemberPath(position);
      if (memberPath) {
        return this.resolveMemberStruct(context, memberPath.slice(0, -1))?.declaration.properties.map((property) => CompletionItemBuilder.buildItem(property)) || [];
      }

      if (completionContext?.structsOnly) {
        const items = document
          .getStructDeclarations()
          .concat(this.getStandardLibStructDeclarations(uri))
          .map((declaration) => CompletionItemBuilder.buildItem(declaration));
        const completions = items.concat(this.getAutoImportCompletionItems(document, liveDocument, autoImportContext, items));
        return autoImportContext ? CompletionList.create(completions, true) : completions;
      }

      const items = this.getLocalScopeCompletionItems(localScope, document).concat(this.getGlobalScopeCompletionItems(document, localScope)).concat(this.getStandardLibCompletionItems(uri));
      const seen = new Set<string>();
      const visible = items.filter((item) => {
        if (seen.has(item.label)) return false;
        seen.add(item.label);
        return true;
      });
      const completions = visible.concat(this.getAutoImportCompletionItems(document, liveDocument, autoImportContext, visible));
      // The client must request again when the typed prefix changes.
      return autoImportContext ? CompletionList.create(completions, true) : completions;
    };
  }

  private getGlobalScopeCompletionItems(document: IndexedDocument, localScope: LocalScope) {
    return document
      .getGlobalDeclarations(
        [],
        localScope.functionDeclarations.map((declaration) => declaration.identifier),
      )
      .map((declaration) => CompletionItemBuilder.buildItem(declaration));
  }

  private getLocalScopeCompletionItems(localScope: LocalScope, document: IndexedDocument) {
    const functionVariablesCompletionItems = localScope.variableDeclarations.map((declaration) => CompletionItemBuilder.buildItem(declaration));
    const functionsCompletionItems = localScope.functionDeclarations.map((declaration) =>
      CompletionItemBuilder.buildItem(document.globalDeclarations.find((candidate) => candidate.identifier === declaration.identifier) || declaration),
    );

    return functionVariablesCompletionItems.concat(functionsCompletionItems);
  }

  private getStandardLibCompletionItems(uri: string) {
    return this.getStandardLibDeclarations(uri).map((declaration) => CompletionItemBuilder.buildItem(declaration));
  }

  private getAutoImportCompletionItems(document: IndexedDocument, liveDocument: TextDocument, context: AutoImportContext | undefined, visible: CompletionItem[]) {
    if (!context) return [];
    const visibleNames = new Set(visible.map((item) => item.label));
    const prefix = context.prefix.toLowerCase();
    const library = this.server.standardLibrary.get(liveDocument.uri);
    const candidates = this.server.documentsCollection.getImportableDocuments(
      document,
      (candidate) => {
        const declarations = context.structsOnly ? candidate.structDeclarations : candidate.globalDeclarations;
        const seen = new Set<string>();
        return declarations.filter((declaration) => {
          if (
            !declaration.identifier.toLowerCase().startsWith(prefix) ||
            visibleNames.has(declaration.identifier) ||
            seen.has(declaration.identifier) ||
            declaration.identifier === "main" ||
            declaration.identifier === "StartingConditional"
          ) {
            return false;
          }
          seen.add(declaration.identifier);
          return true;
        });
      },
      [...library.globalDeclarations, ...library.structDeclarations],
      context.insertionPosition,
      context.replacementRange.start,
    );
    const items: CompletionItem[] = [];
    for (const { document: candidate, declarations } of candidates) {
      for (const declaration of declarations) {
        items.push(CompletionItemBuilder.buildAutoImportItem(declaration, candidate.getIncludeName(), liveDocument, context, this.server.config));
        if (items.length === MAX_AUTO_IMPORT_ITEMS) return items;
      }
    }
    return items;
  }
}
