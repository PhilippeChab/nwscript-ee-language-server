import { each } from "async";
import { readFile } from "fs";
import { createConnection, ProposedFeatures, InitializeParams } from "vscode-languageserver/node";
import { Document } from "./Documents";
import { ServerManager } from "./ServerManager";
import { TokenizedScope } from "./Tokenizer/Tokenizer";

enum Requests {
  setup = "server/setup",
}

const connection = createConnection(ProposedFeatures.all);
let server: ServerManager;

connection.onInitialize(async (params: InitializeParams) => {
  server = new ServerManager(connection, params);

  await server.initialize();

  return server.getCapabilities();
});

connection.onInitialized(() => {});

connection.onRequest(Requests.setup, async () => {
  return await server.up();
});

connection.onShutdown(() => server.down());
connection.onExit(() => server.down());

connection.listen();
