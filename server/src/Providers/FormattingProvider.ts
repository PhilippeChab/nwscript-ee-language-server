import type { Range } from "vscode-languageserver";
import { ClangFormatter } from "./Formatters";
import Provider from "./Provider";

export default class FormattingProvider extends Provider {
  protected async formatDocument(uri: string, range: Range | null = null) {
    const document = this.server.liveDocumentsManager.get(uri);
    if (!document) return;
    const { enabled, verbose, ignoredGlobs, style, executable } = this.server.config.formatter;
    return await new ClangFormatter(this.server.workspaceFilesSystem, enabled, verbose, ignoredGlobs, executable, style, this.server.logger).formatDocument(document, range);
  }
}
