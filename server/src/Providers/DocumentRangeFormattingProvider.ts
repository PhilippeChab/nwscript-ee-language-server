import type { ServerManager } from "../ServerManager";
import FormattingProvider from "./FormattingProvider";

export default class DocumentRangeFormattingProvider extends FormattingProvider {
  constructor(server: ServerManager) {
    super(server);
    this.server.connection.onDocumentRangeFormatting(async ({ textDocument: { uri }, range }) => await this.asyncExceptionsWrapper(async () => await this.formatDocument(uri, range)));
  }
}
