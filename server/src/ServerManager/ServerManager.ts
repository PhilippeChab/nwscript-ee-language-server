import type { Connection, InitializeParams } from "vscode-languageserver";

import {
  CompletionItemsProvider,
  ConfigurationProvider,
  DocumentFormatingProvider,
  DocumentRangeFormattingProvider,
  GotoDefinitionProvider,
  HoverContentProvider,
  SignatureHelpProvider,
  WorkspaceProvider,
} from "../Providers";
import { DocumentsCollection, LiveDocumentsManager } from "../Documents";
import { Tokenizer } from "../Tokenizer";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { Logger } from "../Logger";
import { defaultServerConfiguration } from "./Config";
import CapabilitiesHandler from "./CapabilitiesHandler";

export default class ServerManger {
  public connection: Connection;
  public logger: Logger;
  public capabilitiesHandler: CapabilitiesHandler;
  public workspaceFilesSystem: WorkspaceFilesSystem;
  public liveDocumentsManager: LiveDocumentsManager;
  public config = defaultServerConfiguration;
  public tokenizer: Tokenizer | null = null;
  public documentsCollection: DocumentsCollection | null = null;

  constructor(connection: Connection, params: InitializeParams) {
    this.connection = connection;
    this.logger = new Logger(connection.console);
    this.capabilitiesHandler = new CapabilitiesHandler(params.capabilities);
    this.workspaceFilesSystem = new WorkspaceFilesSystem(params.rootPath!, params.workspaceFolders!);
    this.liveDocumentsManager = new LiveDocumentsManager();

    this.liveDocumentsManager.listen(this.connection);
  }

  public async initialize() {
    this.tokenizer = await new Tokenizer(this.logger).loadGrammar();
    this.documentsCollection = new DocumentsCollection();
    this.registerProviders();
    this.registerLiveDocumentsEvents();

    return this;
  }

  public getCapabilities() {
    return {
      capabilities: this.capabilitiesHandler.capabilities,
    };
  }

  public async up() {
    WorkspaceProvider.register(this);

    if (this.capabilitiesHandler.supportsWorkspaceConfiguration) {
      ConfigurationProvider.register(this, () => {
        this.loadConfig();
      });
    }

    await this.loadConfig();
  }

  public down() {}

  private registerProviders() {
    CompletionItemsProvider.register(this);
    GotoDefinitionProvider.register(this);
    HoverContentProvider.register(this);
    SignatureHelpProvider.register(this);
    DocumentFormatingProvider.register(this);
    DocumentRangeFormattingProvider.register(this);
  }

  private registerLiveDocumentsEvents() {
    this.liveDocumentsManager.onDidSave(async (event) => {
      if (this.tokenizer) {
        await this.documentsCollection?.updateDocument(event.document.uri, this.tokenizer);
      }
    });
  }

  private async loadConfig() {
    const { formatter, ...rest } = await this.connection.workspace.getConfiguration("nwscript-ee-lsp");
    this.config = { ...this.config, ...rest };
    this.config.formatter = { ...this.config.formatter, ...formatter };
  }
}
