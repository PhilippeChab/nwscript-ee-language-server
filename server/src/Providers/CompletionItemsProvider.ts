import { CompletionItem, CompletionList, CompletionParams } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { ServerManager } from "../ServerManager";
import { CompletionItemBuilder } from "./Builders";
import { AutoImportContext, LocalScopeTokenizationResult } from "../Tokenizer/Tokenizer";
import { isStandardLibrary } from "../Documents/StandardLibrary";
import { Document } from "../Documents";
import { LanguageTypes } from "../Tokenizer/constants";
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
      const { liveDocument, document, lines, rawTokenizedContent, localScope } = context;
      if (this.server.tokenizer.isInCommentOrStringFromRaw(rawTokenizedContent, position)) return [];
      const autoImportContext = this.server.config.completion.autoImport ? this.server.tokenizer.getAutoImportContextFromRaw(lines, rawTokenizedContent, position) : undefined;

      const memberPath = this.server.tokenizer.getMemberAccessFromRaw(lines, rawTokenizedContent, position);
      if (memberPath) {
        return this.resolveMemberStruct(context, memberPath.slice(0, -1))?.token.properties.map((property) => CompletionItemBuilder.buildItem(property)) || [];
      }

      if (autoImportContext?.structsOnly || this.server.tokenizer.getActionTargetAtPosition(lines, rawTokenizedContent, position, -2).rawContent === LanguageTypes.struct) {
        const items = document
          .getGlobalStructComplexTokens()
          .concat(this.getStandardLibStructTokens(uri))
          .map((token) => CompletionItemBuilder.buildItem(token));
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

  private getGlobalScopeCompletionItems(document: Document, localScope: LocalScopeTokenizationResult) {
    return document
      .getGlobalComplexTokens(
        [],
        localScope.functionsComplexTokens.map((token) => token.identifier),
      )
      .map((token) => CompletionItemBuilder.buildItem(token, isStandardLibrary(document.uri)));
  }

  private getLocalScopeCompletionItems(localScope: LocalScopeTokenizationResult, document: Document) {
    const functionVariablesCompletionItems = localScope.functionVariablesComplexTokens.map((token) => CompletionItemBuilder.buildItem(token));
    const functionsCompletionItems = localScope.functionsComplexTokens.map((token) =>
      CompletionItemBuilder.buildItem(document.globalDeclarations.find((declaration) => declaration.identifier === token.identifier) || token),
    );

    return functionVariablesCompletionItems.concat(functionsCompletionItems);
  }

  private getStandardLibCompletionItems(uri: string) {
    return this.getStandardLibComplexTokens(uri).map((token) => CompletionItemBuilder.buildItem(token, true));
  }

  private getAutoImportCompletionItems(document: Document, liveDocument: TextDocument, context: AutoImportContext | undefined, visible: CompletionItem[]) {
    if (!context) return [];
    const visibleNames = new Set(visible.map((item) => item.label));
    const prefix = context.prefix.toLowerCase();
    const library = this.server.standardLibrary.get(liveDocument.uri);
    const candidates = this.server.documentsCollection.getImportableDocuments(
      document,
      (candidate) => {
        const tokens = context.structsOnly ? candidate.structDeclarations : candidate.globalDeclarations;
        const seen = new Set<string>();
        return tokens.filter((token) => {
          if (
            !token.identifier.toLowerCase().startsWith(prefix) ||
            visibleNames.has(token.identifier) ||
            seen.has(token.identifier) ||
            token.identifier === "main" ||
            token.identifier === "StartingConditional"
          ) {
            return false;
          }
          seen.add(token.identifier);
          return true;
        });
      },
      [...library.globalDeclarations, ...library.structDeclarations],
      context.insertionPosition,
      context.replacementRange.start,
    );
    const items: CompletionItem[] = [];
    for (const { document: candidate, tokens } of candidates) {
      for (const token of tokens) {
        items.push(CompletionItemBuilder.buildAutoImportItem(token, candidate.getIncludeName(), liveDocument, context, this.server.config));
        if (items.length === MAX_AUTO_IMPORT_ITEMS) return items;
      }
    }
    return items;
  }
}
