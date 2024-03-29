import { cpus } from "os";
import { join } from "path";
import { readFileSync } from "fs";
import { pathToFileURL } from "url";
import * as clustering from "cluster";
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
  SymbolsProvider,
  WorkspaceProvider,
} from "../Providers";
import { DocumentsCollection, LiveDocumentsManager } from "../Documents";
import { Tokenizer } from "../Tokenizer";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
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

  private diagnosticsProvider: DiagnosticsProvider | null = null;

  constructor(connection: Connection, params: InitializeParams) {
    this.connection = connection;
    this.logger = new Logger(connection.console);
    this.capabilitiesHandler = new CapabilitiesHandler(params.capabilities);
    this.workspaceFilesSystem = new WorkspaceFilesSystem(params.rootPath!, params.workspaceFolders!);
    this.liveDocumentsManager = new LiveDocumentsManager();
    this.documentsCollection = new DocumentsCollection();
    this.tokenizer = new Tokenizer();

    this.liveDocumentsManager.listen(this.connection);
  }

  public async initialize() {
    this.tokenizer.loadGrammar();
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
      await ConfigurationProvider.register(this, async () => {
        await this.loadConfig();
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
    const filesPath = this.workspaceFilesSystem.getFilesPath();
    const nwscriptPath = filesPath.find((path) => path.includes("nwscript.nss"));
    const progressReporter = await this.connection.window.createWorkDoneProgress();
    const filesCount = filesPath.length;
    this.logger.info(`Indexing files ...`);

    progressReporter.begin("Indexing files for NWScript: EE Language Server ...", 0);
    const partCount = Math.ceil(filesCount / numCPUs);
    for (let i = 0; i < Math.min(numCPUs, filesCount); i++) {
      const worker = cluster.fork();
      worker.send(filesPath.slice(i * partCount, Math.min((i + 1) * partCount, filesCount - 1)).join(","));
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
        this.diagnosticsProvider?.processDocumentsWaitingForPublish();

        if (nwscriptPath) {
          const fileContent = readFileSync(nwscriptPath).toString();
          const globalScope = this.tokenizer?.tokenizeContent(fileContent, TokenizedScope.global)!;
          this.documentsCollection?.createDocument(pathToFileURL(nwscriptPath).href, globalScope);
        }
      }
    });
  }

  public down() {}

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

  private registerLiveDocumentsEvents() {
    this.liveDocumentsManager.onDidSave((event) => this.diagnosticsProvider?.publish(event.document.uri));
    this.liveDocumentsManager.onWillSave((event) => this.documentsCollection?.updateDocument(event.document, this.tokenizer, this.workspaceFilesSystem));

    this.liveDocumentsManager.onDidOpen((event) => {
      this.documentsCollection?.createDocuments(event.document.uri, event.document.getText(), this.tokenizer, this.workspaceFilesSystem);
      this.diagnosticsProvider?.publish(event.document.uri);
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
