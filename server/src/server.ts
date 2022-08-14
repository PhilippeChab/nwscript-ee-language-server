import { createConnection, ProposedFeatures, InitializeParams } from "vscode-languageserver/node";
import { ServerManager } from "./ServerManager";

const connection = createConnection(ProposedFeatures.all);

let server: ServerManager;

connection.onInitialize(async (params: InitializeParams) => {
  server = new ServerManager(connection, params);
  return (await server.initialize()).getCapabilities();
});

connection.onInitialized(() => {
  server.up();
});

connection.onShutdown(() => server.down());
connection.onExit(() => server.down());

connection.listen();
