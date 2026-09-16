import { readFileSync, existsSync } from "fs";
import { cpus } from "os";
import { join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { fork, ChildProcess } from "child_process";
import type { IndexerMessage } from "../Documents/DocumentsIndexer";
import type { Connection, InitializeParams } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

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
import { ParserService } from "../Parser";
import StandardLibrary, { isStandardLibrary } from "../Documents/StandardLibrary";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { Logger } from "../Logger";
import { defaultServerConfiguration, mergeConfiguration } from "./Config";
import CapabilitiesHandler from "./CapabilitiesHandler";

export default class ServerManger {
  public connection: Connection;
  public logger: Logger;
  public config = mergeConfiguration(defaultServerConfiguration, {});
  public configLoaded = false;
  public capabilitiesHandler: CapabilitiesHandler;
  public workspaceFilesSystem: WorkspaceFilesSystem;
  public liveDocumentsManager: LiveDocumentsManager;
  public documentsCollection: DocumentsCollection;
  public documentsWaitingForPublish: string[] = [];
  public parserService: ParserService;
  public standardLibrary: StandardLibrary;

  private stopping = false;
  private started = false;
  private configurationRevision = 0;
  private readonly initialConfiguration;
  private readonly workers = new Set<ChildProcess>();
  private readonly pendingClientRequests = new Set<() => void>();

  private diagnosticsProvider: DiagnosticsProvider | null = null;

  constructor(connection: Connection, params: InitializeParams) {
    this.initialConfiguration = mergeConfiguration(this.config, params.initializationOptions);
    this.config = this.initialConfiguration;
    this.connection = connection;
    this.logger = new Logger(connection.console);
    this.capabilitiesHandler = new CapabilitiesHandler(params.capabilities);
    this.workspaceFilesSystem = new WorkspaceFilesSystem(params.rootUri ? fileURLToPath(params.rootUri) : params.rootPath ?? null, params.workspaceFolders ?? null);
    this.liveDocumentsManager = new LiveDocumentsManager();
    this.documentsCollection = new DocumentsCollection();
    this.parserService = new ParserService();
    this.standardLibrary = new StandardLibrary(this.workspaceFilesSystem, this.parserService, (message) => this.logger.error(message));

    this.liveDocumentsManager.listen(this.connection);
  }

  public async initialize() {
    await this.parserService.loadGrammar();
    this.registerProviders();
    this.registerLiveDocumentsEvents();

    return this;
  }

  public getCapabilities() {
    return {
      capabilities: this.capabilitiesHandler.capabilities,
    };
  }

  // Optional client features must not prevent language features from starting.
  // Bound stalled requests, and release startup immediately when shutting down.
  public async optionalClientRequest<T>(name: string, request: () => Promise<T>): Promise<T | undefined> {
    if (this.stopping) return undefined;
    return await new Promise<T | undefined>((resolve) => {
      const finish = (value?: T) => {
        clearTimeout(timer);
        this.pendingClientRequests.delete(cancel);
        resolve(value);
      };
      const cancel = () => finish();
      const timer = setTimeout(() => {
        this.logger.error(`Client request ${name} timed out; continuing without it.`);
        finish();
      }, 3000);
      this.pendingClientRequests.add(cancel);
      void Promise.resolve()
        .then(() => (this.stopping ? undefined : request()))
        .then(finish, (error: unknown) => {
          if (this.pendingClientRequests.has(cancel) && !this.stopping) {
            this.logger.error(`Client request ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          finish();
        });
    });
  }

  public async up() {
    if (this.started || this.stopping) return;
    this.started = true;
    WorkspaceProvider.register(this);
    await Promise.all([
      ConfigurationProvider.register(this, (settings) => {
        void this.loadConfig(settings);
      }),
      this.loadConfig(),
    ]);
    if (this.stopping) return;

    const progress = await this.optionalClientRequest("window/workDoneProgress/create", async () => await this.connection.window.createWorkDoneProgress());
    if (this.stopping) return;
    progress?.begin("Indexing NWScript files", 0);
    let indexed = 0;
    try {
      const paths = [...new Set(this.workspaceFilesSystem.getFilesPath().filter((path) => !isStandardLibrary(pathToFileURL(path).href)))];
      this.logger.info("Indexing files ...");
      // Amortize worker startup on small projects, but allow larger workspaces
      // to use more CPUs without spawning a process for every CPU on big hosts.
      const workerLimit = Math.max(4, Math.min(8, Math.ceil(paths.length / 500)));
      const count = Math.min(workerLimit, cpus().length || 1, paths.length);
      const size = count ? Math.ceil(paths.length / count) : 0;
      await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          await this.indexFiles(paths.slice(index * size, (index + 1) * size), (message) => {
            if (message.error) this.logger.error(`Cannot index ${message.filePath}: ${message.error}`);
            if (message.documentTokens) {
              const uri = pathToFileURL(message.filePath).href;
              // An opened document may have newer, unsaved contents.
              if (this.workspaceFilesSystem.getRootForUri(uri) && !this.liveDocumentsManager.get(uri) && existsSync(message.filePath)) {
                this.documentsCollection.createDocument(uri, message.documentTokens);
              }
              indexed++;
              progress?.report(Math.round((100 * indexed) / paths.length));
            }
          });
        }),
      );
    } catch (error) {
      if (!this.stopping) this.logger.error(`Workspace indexing failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (!this.stopping) {
        progress?.done();
        this.logger.info(`Indexed ${indexed} files.`);
        this.configLoaded = true;
        void this.diagnosticsProvider?.processDocumentsWaitingForPublish().catch((error: Error) => this.logger.error(error.message));
      }
    }
  }

  public async down() {
    this.stopping = true;
    for (const cancel of this.pendingClientRequests) cancel();
    await Promise.all(
      [...this.workers].map(async (worker) => {
        await new Promise<void>((resolve) => {
          worker.once("close", () => resolve());
          worker.kill();
        });
      }),
    );
  }

  public refreshStandardLibrary() {
    this.standardLibrary.invalidate();
    this.revalidateOpenDocuments();
  }

  public revalidateOpenDocuments() {
    for (const document of this.liveDocumentsManager.all()) {
      if (!isStandardLibrary(document.uri)) {
        void this.diagnosticsProvider?.publish(document.uri).catch((error: Error) => this.logger.error(error.message));
      }
    }
  }

  public refreshDocument(uri: string) {
    try {
      const live = this.liveDocumentsManager.get(uri);
      this.updateDocument(live || TextDocument.create(uri, "nwscript", 0, readFileSync(fileURLToPath(uri), "utf8")));
    } catch (error) {
      this.logger.error(`Cannot refresh ${uri}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public refreshWorkspaceDocuments() {
    const uris = new Set(this.workspaceFilesSystem.getFilesPath().map((path) => pathToFileURL(path).href));
    for (const document of this.documentsCollection.getWorkspaceDocuments()) {
      if (!uris.has(document.uri)) this.documentsCollection.removeDocument(document.uri);
    }
    for (const uri of uris) {
      if (!isStandardLibrary(uri)) this.refreshDocument(uri);
    }
    this.refreshStandardLibrary();
  }

  private async indexFiles(paths: string[], onMessage: (message: IndexerMessage) => void) {
    if (!paths.length || this.stopping) return;
    await new Promise<void>((resolve) => {
      const worker = fork(join(__dirname, "indexer.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      this.workers.add(worker);
      worker.stderr?.on("data", (chunk: Buffer) => {
        if (!this.stopping) this.logger.error(chunk.toString());
      });
      worker.on("message", (message: IndexerMessage) => {
        if (!this.stopping) onMessage(message);
      });
      worker.on("error", (error) => {
        if (!this.stopping) this.logger.error(`Indexer failed: ${error.message}`);
      });
      worker.on("close", (code) => {
        this.workers.delete(worker);
        if (code !== 0 && !this.stopping) this.logger.error(`Indexer exited with code ${String(code)}; available documents remain usable.`);
        resolve();
      });
      worker.send(paths, (error) => {
        if (error && !this.stopping) this.logger.error(`Cannot start indexing: ${error.message}`);
      });
    });
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

  private updateDocument(document: TextDocument) {
    if (isStandardLibrary(document.uri)) {
      this.standardLibrary.change(document);
      // Retain the selected API's last usable snapshot independently of this
      // document's own scope, which may be empty or supply a different API.
      this.standardLibrary.get(document.uri);
    }
    try {
      this.documentsCollection.updateDocument(document, this.parserService, this.workspaceFilesSystem);
    } catch (error) {
      // Register unfinished new documents; retain existing usable scopes.
      if (!this.documentsCollection.getFromUri(document.uri)) {
        this.documentsCollection.createDocument(document.uri, { includes: [], globalDeclarations: [], structDeclarations: [] });
      }
      this.logger.error(`Cannot index ${document.uri}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private registerLiveDocumentsEvents() {
    this.liveDocumentsManager.onDidChangeContent((event) => {
      if (isStandardLibrary(event.document.uri)) {
        this.updateDocument(event.document);
      }
    });
    this.liveDocumentsManager.onDidClose(({ document }) => {
      this.standardLibrary.close(document.uri);
      if (!isStandardLibrary(document.uri)) {
        if (this.workspaceFilesSystem.getRootForUri(document.uri) && existsSync(fileURLToPath(document.uri))) this.refreshDocument(document.uri);
        else this.documentsCollection.removeDocument(document.uri);
      }
    });
    this.liveDocumentsManager.onDidSave((event) => {
      if (isStandardLibrary(event.document.uri)) this.refreshStandardLibrary();
      else {
        this.updateDocument(event.document);
        void this.diagnosticsProvider?.publish(event.document.uri);
      }
    });
    this.liveDocumentsManager.onWillSave((event) => {
      if (!isStandardLibrary(event.document.uri)) this.updateDocument(event.document);
    });

    this.liveDocumentsManager.onDidOpen((event) => {
      this.updateDocument(event.document);
      void this.diagnosticsProvider?.publish(event.document.uri);
    });
  }

  private applyConfiguration(settings: unknown, fullResponse = false) {
    const previousCompiler = this.config.compiler;
    this.config = mergeConfiguration(this.config, settings, fullResponse ? this.initialConfiguration : undefined);
    // Before indexing completes, queued diagnostics will use the new settings.
    // Afterwards, retry open files even if the client never edits or saves them.
    if (!this.stopping && JSON.stringify(previousCompiler) !== JSON.stringify(this.config.compiler)) {
      this.diagnosticsProvider?.configurationChanged();
      if (this.configLoaded) this.revalidateOpenDocuments();
    }
  }

  private async loadConfig(settings?: unknown) {
    const revision = ++this.configurationRevision;
    this.applyConfiguration(settings);
    if (this.capabilitiesHandler.getSupportsWorkspaceConfiguration()) {
      await this.optionalClientRequest("workspace/configuration", async () => {
        const received = await this.connection.workspace.getConfiguration("nwscript-ee-lsp");
        // The timeout releases startup, but a late response is still useful.
        // A slower previous response must not overwrite a newer update.
        if (!this.stopping && revision === this.configurationRevision) this.applyConfiguration(received, true);
      });
    }
  }
}
