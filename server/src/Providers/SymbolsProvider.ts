import { DocumentSymbol, DocumentSymbolParams, SymbolKind } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { SymbolBuilder } from "./Builders";
import { LocalScopeTokenizationResult, TokenizedScope } from "../Tokenizer/Tokenizer";
import { Document } from "../Documents";
import { LanguageTypes } from "../Tokenizer/constants";
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

      if (liveDocument) {
        const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local);

        if (localScope) {
          return [
            DocumentSymbol.create(
              document?.getKey()!,
              undefined,
              SymbolKind.File,
              { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              this.getLocalScopeSymbols(localScope),
            ),
          ];
          // .concat(this.getGlobalScopeSymbols(document))
          // .concat(this.getStandardLibSymbols());
        }
      }
    };
  }

  private getLocalScopeSymbols(localScope: LocalScopeTokenizationResult) {
    return localScope.functionsComplexTokens.map((token) => {
      return SymbolBuilder.buildItem(
        token,
        localScope.functionVariablesComplexTokens.filter((variableToken) => variableToken.parentIdentifier === token.identifier),
      );
    });

    // return functionVariablesCompletionItems;
    // const functionsCompletionItems = localScope.functionsComplexTokens.map((token) => SymbolBuilder.buildItem(token, uri));
    // return functionVariablesCompletionItems.concat(functionsCompletionItems);
  }

  //   private getGlobalScopeSymbols(document: Document | undefined) {
  //     return (
  //       document?.getGlobalComplexTokensWithRef([]).flatMap((ownedTokens) => {
  //         const uri = ownedTokens.owner;

  //         return ownedTokens.tokens.map((token) => SymbolBuilder.buildItem(token, uri));
  //       }) || []
  //     );
  //   }

  //   private getStandardLibSymbols() {
  //     return this.getStandardLibComplexTokens().map((token) => SymbolBuilder.buildItem(token, undefined));
  //   }
}
