import { cpus } from "os";
import { join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as clustering from "cluster";
import type { Connection, InitializeParams } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

import {
  CompletionItemsProvider,
  ConfigurationProvider,
  DiagnosticsProvider,
  DocumentFormatingProvider,
  DocumentRangeFormattingProvider,
  GotoDefinitionProvider,
  HoverContentProvider,
  SignatureHelpProvider,
  SymbolsProvider,
  WorkspaceProvider,
} from "../Providers";
import { DocumentsCollection, LiveDocumentsManager } from "../Documents";
import { Tokenizer } from "../Tokenizer";
import StandardLibrary, { isStandardLibrary } from "../Documents/StandardLibrary";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { Logger } from "../Logger";
import { defaultServerConfiguration } from "./Config";
import CapabilitiesHandler from "./CapabilitiesHandler";

export default class ServerManger {
  public connection: Connection;
  public logger: Logger;
  public config = defaultServerConfiguration;
  public configLoaded = false;
  public capabilitiesHandler: CapabilitiesHandler;
  public workspaceFilesSystem: WorkspaceFilesSystem;
  public liveDocumentsManager: LiveDocumentsManager;
  public documentsCollection: DocumentsCollection;
  public documentsWaitingForPublish: string[] = [];
  public tokenizer: Tokenizer;
  public standardLibrary: StandardLibrary;

  private diagnosticsProvider: DiagnosticsProvider | null = null;

  constructor(connection: Connection, params: InitializeParams) {
    this.connection = connection;
    this.logger = new Logger(connection.console);
    this.capabilitiesHandler = new CapabilitiesHandler(params.capabilities);
    this.workspaceFilesSystem = new WorkspaceFilesSystem(params.rootUri ? fileURLToPath(params.rootUri) : params.rootPath ?? null, params.workspaceFolders ?? null);
    this.liveDocumentsManager = new LiveDocumentsManager();
    this.documentsCollection = new DocumentsCollection();
    this.tokenizer = new Tokenizer();
    this.standardLibrary = new StandardLibrary(this.workspaceFilesSystem, this.tokenizer, (message) => this.logger.error(message));

    this.liveDocumentsManager.listen(this.connection);
  }

  public async initialize() {
    await this.tokenizer.loadGrammar();
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
        void this.loadConfig().catch((error: Error) => this.logger.error(error.message));
      });
    }

    await this.loadConfig();

    const numCPUs = cpus().length;
    const cluster = clustering.default;
    if (cluster.isPrimary) {
      cluster.setupPrimary({
        exec: join(__dirname, "indexer.js"),
      });
    }

    let filesIndexedCount = 0;
    const filesPath = this.workspaceFilesSystem.getFilesPath().filter((path) => !isStandardLibrary(path));
    const progressReporter = await this.connection.window.createWorkDoneProgress();
    const filesCount = filesPath.length;
    this.logger.info("Indexing files ...");

    progressReporter.begin("Indexing files for NWScript: EE Language Server ...", 0);
    if (!filesCount) {
      progressReporter.done();
      this.configLoaded = true;
      void this.diagnosticsProvider?.processDocumentsWaitingForPublish();
      return;
    }
    const partCount = Math.ceil(filesCount / numCPUs);
    for (let i = 0; i < Math.min(numCPUs, filesCount); i++) {
      const worker = cluster.fork();
      worker.send(filesPath.slice(i * partCount, Math.min((i + 1) * partCount, filesCount)).join(","));
      worker.on("message", (message: string) => {
        const { filePath, globalScope } = JSON.parse(message);
        this.documentsCollection?.createDocument(pathToFileURL(filePath).href, globalScope);
        filesIndexedCount++;
        progressReporter?.report(filesIndexedCount / filesCount);
      });
    }

    cluster.on("exit", () => {
      if (Object.keys(cluster.workers || {}).length === 0) {
        progressReporter?.done();
        this.logger.info(`Indexed ${filesIndexedCount} files.`);
        this.configLoaded = true;
        void this.diagnosticsProvider?.processDocumentsWaitingForPublish();
      }
    });
  }

  public down() {}

  public refreshStandardLibrary() {
    this.standardLibrary.invalidate();
    for (const document of this.liveDocumentsManager.all()) {
      if (!isStandardLibrary(document.uri)) {
        void this.diagnosticsProvider?.publish(document.uri).catch((error: Error) => this.logger.error(error.message));
      }
    }
  }

  private registerProviders() {
    CompletionItemsProvider.register(this);
    GotoDefinitionProvider.register(this);
    HoverContentProvider.register(this);
    SignatureHelpProvider.register(this);
    DocumentFormatingProvider.register(this);
    DocumentRangeFormattingProvider.register(this);
    SymbolsProvider.register(this);

    this.diagnosticsProvider = DiagnosticsProvider.register(this) as DiagnosticsProvider;
  }

  private registerStandardLibraryDocument(document: TextDocument) {
    this.standardLibrary.change(document);
    // Retain the workspace API's last usable snapshot independently of whether
    // this opened file supplies that API.
    this.standardLibrary.get(document.uri);
    try {
      this.documentsCollection.updateDocument(document, this.tokenizer, this.workspaceFilesSystem);
    } catch (error) {
      // An unfinished declaration must not prevent registering a newly opened
      // document. Keep an existing document's last usable scope when possible.
      if (!this.documentsCollection.getFromUri(document.uri)) {
        this.documentsCollection.createDocument(document.uri, { children: [], complexTokens: [], structComplexTokens: [] });
      }
      this.logger.error(`Cannot index ${document.uri}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private registerLiveDocumentsEvents() {
    this.liveDocumentsManager.onDidChangeContent((event) => {
      if (isStandardLibrary(event.document.uri)) {
        this.registerStandardLibraryDocument(event.document);
      }
    });
    this.liveDocumentsManager.onDidClose((event) => this.standardLibrary.close(event.document.uri));
    this.liveDocumentsManager.onDidSave((event) => {
      if (isStandardLibrary(event.document.uri)) this.refreshStandardLibrary();
      else void this.diagnosticsProvider?.publish(event.document.uri);
    });
    this.liveDocumentsManager.onWillSave((event) => {
      if (!isStandardLibrary(event.document.uri)) this.documentsCollection?.updateDocument(event.document, this.tokenizer, this.workspaceFilesSystem);
    });

    this.liveDocumentsManager.onDidOpen((event) => {
      if (isStandardLibrary(event.document.uri)) {
        this.registerStandardLibraryDocument(event.document);
      } else {
        this.documentsCollection?.createDocuments(event.document.uri, event.document.getText(), this.tokenizer, this.workspaceFilesSystem);
      }
      void this.diagnosticsProvider?.publish(event.document.uri);
    });
  }

  private async loadConfig() {
    const { completion, hovering, formatter, compiler, ...rest } = await this.connection.workspace.getConfiguration("nwscript-ee-lsp");
    this.config = { ...this.config, ...rest };
    this.config.completion = { ...this.config.completion, ...completion };
    this.config.hovering = { ...this.config.hovering, ...hovering };
    this.config.formatter = { ...this.config.formatter, ...formatter };
    this.config.compiler = { ...this.config.compiler, ...compiler };
  }
}
