import type { Connection, InitializeParams, InitializeResult } from "vscode-languageserver";
import { TextDocumentSyncKind } from "vscode-languageserver";

import { DocumentsCollection, LiveDocumentsManager } from "../Documents";
import { CompletionItemsProvider, GotoDefinitionProvider, HoverContentProvider, TriggerCharacters } from "../Providers";
import { Tokenizer } from "../Tokenizer";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { Logger } from "../Logger";

export default class ServerManger {
  public connection: Connection;
  public logger: Logger;
  public workspaceFilesSystem: WorkspaceFilesSystem;
  public liveDocumentsManager: LiveDocumentsManager;
  public tokenizer: Tokenizer | null = null;
  public documentsCollection: DocumentsCollection | null = null;

  constructor(connection: Connection, params: InitializeParams) {
    this.connection = connection;
    this.logger = new Logger(connection.console);
    this.workspaceFilesSystem = new WorkspaceFilesSystem(params.rootPath!);
    this.liveDocumentsManager = new LiveDocumentsManager();

    this.liveDocumentsManager.listen(this.connection);
  }

  /**
   * Initialize should be run during the initialization phase of the client connection
   */
  public async initialize() {
    this.tokenizer = await new Tokenizer(this.logger).loadGrammar();
    //this.documentsCollection = await new DocumentsCollection().initialize(this.workspaceFilesSystem, this.tokenizer);
    this.documentsCollection = new DocumentsCollection();
    this.registerProviders();
    this.registerLiveDocumentsEvents();

    return this;
  }

  public get capabilities(): InitializeResult {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        definitionProvider: true,
        hoverProvider: true,
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: [TriggerCharacters.dot],
        },
      },
    };
  }

  /**
   * Setup should be run after the client connection has been initialized. We can do things here like
   * handle changes to the workspace and query configuration settings
   */
  public async setup() {
    if (this.tokenizer) {
      await this.documentsCollection?.initialize(this.workspaceFilesSystem, this.tokenizer);
    }
  }

  public shutdown() {}

  private registerProviders() {
    if (this.tokenizer && this.documentsCollection) {
      CompletionItemsProvider.register(this);
      GotoDefinitionProvider.register(this);
      HoverContentProvider.register(this);
    }
  }

  private registerLiveDocumentsEvents() {
    this.liveDocumentsManager.onDidSave(async (event) => {
      if (this.tokenizer) {
        await this.documentsCollection?.updateDocument(event.document.uri, this.tokenizer);
      }
    });
  }
}
