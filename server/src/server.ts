import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver/node";

import { CompletionItemsProvider } from "./completionItemsProvider";
import { TextDocument } from "vscode-languageserver-textdocument";
import { WorkspaceFilesManager } from "./workspaceFiles";
import { DocumentsCollection } from "./documents";
import { Logger } from "./logger";

export const connection = createConnection(ProposedFeatures.all);
export let workspaceFilesManager: WorkspaceFilesManager;
export let completionItemsProvider: CompletionItemsProvider;
export let logger: Logger;

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize(async (params: InitializeParams) => {
  const capabilities = params.capabilities;

  logger = new Logger(connection.console);
  workspaceFilesManager = new WorkspaceFilesManager(params.rootPath!);
  completionItemsProvider = new CompletionItemsProvider(await new DocumentsCollection().initialize());

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
  hasWorkspaceFolderCapability = !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders);
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
      },
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {});

connection.onDidChangeConfiguration((change) => {});

// Only keep settings for open documents
documents.onDidClose((e) => {});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {});

connection.onDidChangeWatchedFiles((change) => {});

// This handler provides the initial list of the completion items.
connection.onCompletion((params) => {
  // The pass parameter contains the position of the text document in
  // which code complete got requested. For the example we ignore this
  // info and always provide the same completion items.

  return completionItemsProvider.getGlobalCompletionItemsFromUri(params.textDocument.uri);
});

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
