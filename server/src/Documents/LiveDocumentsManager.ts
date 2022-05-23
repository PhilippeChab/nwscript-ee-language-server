import type { Connection, Disposable, TextDocumentChangeEvent } from "vscode-languageserver";
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

export default class DocumentManager {
  private readonly documents: TextDocuments<TextDocument>;

  constructor() {
    this.documents = new TextDocuments(TextDocument);
  }

  public onDidSave(cb: (e: TextDocumentChangeEvent<TextDocument>) => any, thisArgs?: any, disposables?: Disposable[]) {
    this.documents.onDidSave(cb);
  }

  public get(uri: string) {
    return this.documents.get(uri);
  }

  public listen(connection: Connection) {
    this.documents.listen(connection);
  }
}
