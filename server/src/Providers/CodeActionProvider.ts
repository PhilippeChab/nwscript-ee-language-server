import { CodeAction, CodeActionKind, CodeActionParams, TextEdit } from "vscode-languageserver";

import type { ServerManager } from "../ServerManager";
import { computeIncludeInsertPosition } from "../Utils/includeInsertPosition";
import Provider from "./Provider";

export default class CodeActionProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onCodeAction((params) => this.exceptionsWrapper(this.providerHandler(params), []));
  }

  private providerHandler(params: CodeActionParams) {
    return () => {
      const {
        textDocument: { uri },
        context,
      } = params;

      if (!context.diagnostics.length) return [];

      const liveDocument = this.server.liveDocumentsManager.get(uri);
      const document = this.server.documentsCollection.getFromUri(uri);
      if (!liveDocument || !document) return [];

      const actions: CodeAction[] = [];
      const text = liveDocument.getText();
      const lines = text.split("\n");
      const children = document.getChildren();
      const ownKey = document.getKey();
      const excludedKeys = new Set([ownKey, ...children]);
      const isQueueSrc = uri.includes("queue_src");

      // Build a set of identifiers already in scope to avoid false positives
      const inScopeIdentifiers = new Set<string>();
      document.getGlobalComplexTokens().forEach((t) => inScopeIdentifiers.add(t.identifier));
      document.getGlobalStructComplexTokens().forEach((t) => inScopeIdentifiers.add(t.identifier));
      this.getStandardLibComplexTokens().forEach((t) => inScopeIdentifiers.add(t.identifier));

      for (const diagnostic of context.diagnostics) {
        const line = lines[diagnostic.range.start.line];
        if (!line) continue;

        // Diagnostics may span the entire line, so extract all identifiers
        // from the line and filter to those not already in scope.
        const lineIdentifiers = (line.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter((id) => !inScopeIdentifiers.has(id));
        if (lineIdentifiers.length === 0) continue;

        const identifiersSet = new Set(lineIdentifiers);
        const suggestedKeys = new Set<string>();

        this.server.documentsCollection.forEach((doc) => {
          const docKey = doc.getKey();

          if (doc.base || excludedKeys.has(docKey)) return;
          if (suggestedKeys.has(docKey)) return;

          const docIsQueueSrc = doc.uri.includes("queue_src");
          if (isQueueSrc !== docIsQueueSrc) return;

          const hasSymbol =
            doc.complexTokens.some((token) => identifiersSet.has(token.identifier)) ||
            doc.structComplexTokens.some((token) => identifiersSet.has(token.identifier));

          if (hasSymbol) {
            suggestedKeys.add(docKey);
            const insertPosition = computeIncludeInsertPosition(text);
            actions.push({
              title: `Add #include "${docKey}"`,
              kind: CodeActionKind.QuickFix,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [uri]: [TextEdit.insert(insertPosition, `#include "${docKey}"\n`)],
                },
              },
            });
          }
        });
      }

      return actions;
    };
  }
}
