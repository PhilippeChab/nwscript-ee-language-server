import { createConnection, TextDocuments, ProposedFeatures, InitializeParams } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { ServerManager } from "./ServerManager";

const connection = createConnection(ProposedFeatures.all);
let server: ServerManager;

connection.onInitialize(async (params: InitializeParams) => {
  server = new ServerManager(connection, params);

  await server.initialize();

  return server.capabilities;
});

connection.onInitialized(() => {
  server.setup();
});

connection.onShutdown(() => server.shutdown());
connection.onExit(() => server.shutdown());

connection.listen();
