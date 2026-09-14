import { CompletionItem, CompletionList, CompletionParams } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { ServerManager } from "../ServerManager";
import type { ComplexToken } from "../Tokenizer/types";
import { CompletionItemBuilder } from "./Builders";
import { AutoImportContext, LocalScopeTokenizationResult } from "../Tokenizer/Tokenizer";
import { TriggerCharacters } from ".";
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

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const indexedDocument = this.server.documentsCollection.getFromUri(uri);
      if (!liveDocument || !indexedDocument) return;

      const [lines, rawTokenizedContent] = this.server.tokenizer.tokenizeContentToRaw(liveDocument.getText());
      const document = indexedDocument.withGlobalScope(this.server.tokenizer.tokenizeGlobalScopeFromRaw(lines, rawTokenizedContent));
      const localScope = this.server.tokenizer.tokenizeContentFromRaw(lines, rawTokenizedContent, 0, position.line);
      const autoImportContext = this.server.config.completion.autoImport ? this.server.tokenizer.getAutoImportContextFromRaw(lines, rawTokenizedContent, position) : undefined;

      if (params.context?.triggerCharacter === TriggerCharacters.dot) {
        const { rawContent } = this.server.tokenizer.getActionTargetAtPosition(lines, rawTokenizedContent, position, -1);
        const structIdentifer = localScope.functionVariablesComplexTokens.find((token) => token.identifier === rawContent)?.valueType;

        return document
          .getGlobalStructComplexTokens()
          .concat(this.getStandardLibStructTokens(uri))
          .find((token) => token.identifier === structIdentifer)
          ?.properties.map((property) => {
            return CompletionItemBuilder.buildItem(property);
          });
      }

      if (autoImportContext?.structsOnly || this.server.tokenizer.getActionTargetAtPosition(lines, rawTokenizedContent, position, -2).rawContent === LanguageTypes.struct) {
        const items = document
          .getGlobalStructComplexTokens()
          .concat(this.getStandardLibStructTokens(uri))
          .map((token) => CompletionItemBuilder.buildItem(token));
        const completions = items.concat(this.getAutoImportCompletionItems(document, liveDocument, autoImportContext, items));
        return autoImportContext ? CompletionList.create(completions, true) : completions;
      }

      const items = this.getGlobalScopeCompletionItems(document, localScope).concat(this.getLocalScopeCompletionItems(localScope)).concat(this.getStandardLibCompletionItems(uri));
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
      .map((token) => CompletionItemBuilder.buildItem(token));
  }

  private getLocalScopeCompletionItems(localScope: LocalScopeTokenizationResult) {
    const functionVariablesCompletionItems = localScope.functionVariablesComplexTokens.map((token) => CompletionItemBuilder.buildItem(token));
    const functionsCompletionItems = localScope.functionsComplexTokens.map((token) => CompletionItemBuilder.buildItem(token));

    return functionVariablesCompletionItems.concat(functionsCompletionItems);
  }

  private getStandardLibCompletionItems(uri: string) {
    return this.getStandardLibComplexTokens(uri).map((token) => CompletionItemBuilder.buildItem(token));
  }

  private getAutoImportCompletionItems(document: Document, liveDocument: TextDocument, context: AutoImportContext | undefined, visible: CompletionItem[]) {
    if (!context) return [];
    const visibleNames = new Set(visible.map((item) => item.label));
    const prefix = context.prefix.toLowerCase();
    const matchingTokens = new Map<Document, ComplexToken[]>();
    const candidates = this.server.documentsCollection.getImportableDocuments(document, (candidate) => {
      const tokens = context.structsOnly ? candidate.structComplexTokens : candidate.complexTokens;
      const seen = new Set<string>();
      const matches = tokens.filter((token) => {
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
      matchingTokens.set(candidate, matches);
      return matches.length > 0;
    });
    const items: CompletionItem[] = [];
    for (const candidate of candidates) {
      for (const token of matchingTokens.get(candidate) || []) {
        items.push(CompletionItemBuilder.buildAutoImportItem(token, candidate.getIncludeName(), liveDocument, context, this.server.config));
        if (items.length === MAX_AUTO_IMPORT_ITEMS) return items;
      }
    }
    return items;
  }
}
