import type { ServerManager } from "../ServerManager";
import FormattingProvider from "./FormattingProvider";

export default class DocumentFormattingProvider extends FormattingProvider {
  constructor(server: ServerManager) {
    super(server);
    this.server.connection.onDocumentFormatting(async ({ textDocument: { uri } }) => await this.asyncExceptionsWrapper(async () => await this.formatDocument(uri)));
  }
}
