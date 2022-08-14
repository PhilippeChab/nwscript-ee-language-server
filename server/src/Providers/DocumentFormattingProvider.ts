import { DocumentFormattingParams } from "vscode-languageserver";

import { ServerManager } from "../ServerManager";
import { ClangFormatter } from "./Formatters";
import Provider from "./Provider";

export default class DocumentFormattingProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.connection.onDocumentFormatting(
      async (params) => await this.asyncExceptionsWrapper(this.providerHandler(params)),
    );
  }

  private providerHandler(params: DocumentFormattingParams) {
    return async () => {
      const {
        textDocument: { uri },
      } = params;
      const { enabled, ignoredGlobs, style, executable } = this.server.config.formatter;
      const clangFormatter = new ClangFormatter(
        this.server.workspaceFilesSystem,
        ignoredGlobs,
        executable,
        style,
        this.server.logger,
      );

      if (!enabled || clangFormatter.isIgnoredFile(uri)) {
        return undefined;
      }

      const liveDocument = this.server.liveDocumentsManager.get(uri);

      if (liveDocument) {
        return await clangFormatter.formatDocument(liveDocument, null);
      }

      return undefined;
    };
  }
}
