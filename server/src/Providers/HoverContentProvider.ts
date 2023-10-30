import { CompletionItemKind, HoverParams, Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { ServerManager } from "../ServerManager";
import type { ComplexToken } from "../Tokenizer/types";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import { HoverContentBuilder } from "./Builders";
import { Document } from "../Documents";
import Provider from "./Provider";

export default class HoverContentProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onHover((params) => this.exceptionsWrapper(this.providerHandler(params)));
  }

  private providerHandler(params: HoverParams) {
    return () => {
      const {
        textDocument: { uri },
        position,
      } = params;

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const document = this.server.documentsCollection.getFromUri(uri);
      if (!liveDocument || !document) return;

      let token = this.resolveToken(position, document, liveDocument);

      if (token) {
        return {
          contents: HoverContentBuilder.buildItem(token, this.server.config),
        };
      }
    };
  }

  private resolveToken(position: Position, document: Document, liveDocument: TextDocument) {
    let tokens;
    let token: ComplexToken | undefined;

    const { tokenType, structVariableIdentifier, identifier } = this.server.tokenizer.findActionTargetAtPosition(liveDocument.getText(), position);
    const localScope = this.server.tokenizer?.tokenizeContent(liveDocument.getText(), TokenizedScope.local, 0, position.line);

    switch (tokenType) {
      case CompletionItemKind.Function:
      case CompletionItemKind.Constant:
        token = localScope.functionsComplexTokens.find((candidate) => candidate.identifier === identifier);
        if (token) break;

        tokens = document.getGlobalComplexTokens();
        token = tokens.find((candidate) => candidate.identifier === identifier);
        if (token) break;

        tokens = this.server.documentsCollection.standardLibComplexTokens;
        token = tokens.find((candidate) => candidate.identifier === identifier);
        break;
      case CompletionItemKind.Struct:
        tokens = document.getGlobalStructComplexTokens();
        token = tokens.find((candidate) => candidate.identifier === identifier);
        break;
      case CompletionItemKind.Property:
        const structIdentifer = localScope?.functionVariablesComplexTokens.find((candidate) => candidate.identifier === structVariableIdentifier)?.valueType;

        token = document
          .getGlobalStructComplexTokens()
          .find((candidate) => candidate.identifier === structIdentifer)
          ?.properties.find((property) => property.identifier === identifier);
        break;
      default:
        token = localScope.functionVariablesComplexTokens.find((candidate) => candidate.identifier === identifier);
    }

    return token;
  }
}
