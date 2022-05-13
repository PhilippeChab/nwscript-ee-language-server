import type { Connection, TextDocumentIdentifier } from "vscode-languageserver";
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

export default class DocumentManager {
  private readonly documents: TextDocuments<TextDocument>;

  constructor() {
    this.documents = new TextDocuments(TextDocument);
  }

  public get(id: TextDocumentIdentifier | string) {
    const docId = typeof id === "string" ? id : id.uri;

    return this.documents.get(docId);
  }

  public listen(connection: Connection) {
    this.documents.listen(connection);
  }
}
