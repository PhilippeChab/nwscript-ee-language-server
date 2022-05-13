import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  CompletionItem,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver/node";

import { CompletionItemsProvider, TriggerCharacters } from "./completionItemsProvider";
import { TextDocument } from "vscode-languageserver-textdocument";
import { WorkspaceFilesManager } from "./workspaceFiles";
import { DocumentsCollection } from "./documents";
import { Logger } from "./logger";
import { Tokenizer } from "./tokenizer";

export let tokenizer: Tokenizer;
export let workspaceFilesManager: WorkspaceFilesManager;
export let completionItemsProvider: CompletionItemsProvider;
export let logger: Logger;

const documents = new TextDocuments(TextDocument);
const connection = createConnection(ProposedFeatures.all);

connection.onInitialize(async (params: InitializeParams) => {
  logger = new Logger(connection.console);
  workspaceFilesManager = new WorkspaceFilesManager(params.rootPath!);
  tokenizer = await new Tokenizer().loadGrammar();
  completionItemsProvider = new CompletionItemsProvider(await new DocumentsCollection().initialize());

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [TriggerCharacters.dot],
      },
    },
  } as InitializeResult;
});

connection.onInitialized(() => {});

connection.onDidChangeConfiguration((change) => {});

// Only keep settings for open documents
documents.onDidClose((e) => {});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {});

connection.onDidChangeWatchedFiles((change) => {});

connection.onCompletion((params) => {
  if (params.context?.triggerCharacter === TriggerCharacters.dot) {
    return completionItemsProvider.getStructureProperties(params.textDocument.uri, params.position);
  }

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
