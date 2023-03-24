import { cpus } from "os";
import { join } from "path";
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
  public hasIndexedDocuments = false;
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

    const diagnosticsProvider = DiagnosticsProvider.register(this) as DiagnosticsProvider;
    const numCPUs = cpus().length;
    const cluster = clustering.default;
    if (cluster.isPrimary) {
      cluster.setupPrimary({
        exec: join(__dirname, "indexer.js"),
      });
    }

    let filesIndexedCount = 0;
    const filesPath = this.workspaceFilesSystem.getAllFilesPath();
    const progressReporter = await this.connection.window.createWorkDoneProgress();
    const filesCount = filesPath.length;

    progressReporter.begin("Indexing files for NWScript: EE LSP ...", 0);
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
        this.hasIndexedDocuments = true;
        console.log(filesIndexedCount);
        diagnosticsProvider?.processDocumentsWaitingForPublish();
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
  }

  private registerLiveDocumentsEvents() {
    this.liveDocumentsManager.onWillSave((event) => {
      if (this.tokenizer) {
        this.documentsCollection?.updateDocument(event.document, this.tokenizer);
      }
    });
  }

  private async loadConfig() {
    const { formatter, compiler, ...rest } = await this.connection.workspace.getConfiguration("nwscript-ee-lsp");
    this.config = { ...this.config, ...rest };
    this.config.formatter = { ...this.config.formatter, ...formatter };
    this.config.compiler = { ...this.config.compiler, ...compiler };
  }
}
