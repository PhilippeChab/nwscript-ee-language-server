import type { Connection, InitializeParams } from "vscode-languageserver";

import {
  CompletionItemsProvider,
  ConfigurationProvider,
  DiagnosticsProvider,
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
  public config = defaultServerConfiguration;
  public capabilitiesHandler: CapabilitiesHandler;
  public workspaceFilesSystem: WorkspaceFilesSystem;
  public liveDocumentsManager: LiveDocumentsManager;
  public documentsCollection: DocumentsCollection;
  public tokenizer: Tokenizer | null = null;
  public documentsWaitingForPublish: string[] = [];

  constructor(connection: Connection, params: InitializeParams) {
    this.connection = connection;
    this.logger = new Logger(connection.console);
    this.capabilitiesHandler = new CapabilitiesHandler(params.capabilities);
    this.workspaceFilesSystem = new WorkspaceFilesSystem(params.rootPath!, params.workspaceFolders!);
    this.liveDocumentsManager = new LiveDocumentsManager();
    this.documentsCollection = new DocumentsCollection();

    this.liveDocumentsManager.listen(this.connection);
  }

  public async initialize() {
    this.tokenizer = await new Tokenizer().loadGrammar();
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

    if (this.capabilitiesHandler.getSupportsWorkspaceConfiguration()) {
      await ConfigurationProvider.register(this, () => {
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
    const diagnosticProvider = DiagnosticsProvider.register(this) as DiagnosticsProvider;

    this.liveDocumentsManager.onWillSave((event) => {
      if (this.tokenizer) {
        this.documentsCollection?.updateDocument(event.document, this.tokenizer, this.workspaceFilesSystem);
      }
    });

    this.liveDocumentsManager.onDidSave((event) => diagnosticProvider.publish(event.document.uri));

    this.liveDocumentsManager.onDidOpen((event) => {
      if (this.tokenizer) {
        this.documentsCollection?.createDocuments(
          event.document.uri,
          event.document.getText(),
          this.tokenizer,
          this.workspaceFilesSystem,
        );
      }

      diagnosticProvider.publish(event.document.uri);
    });
  }

  private async loadConfig() {
    const { formatter, compiler, ...rest } = await this.connection.workspace.getConfiguration("nwscript-ee-lsp");
    this.config = { ...this.config, ...rest };
    this.config.formatter = { ...this.config.formatter, ...formatter };
    this.config.compiler = { ...this.config.compiler, ...compiler };
  }
}
