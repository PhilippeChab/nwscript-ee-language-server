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

  return server.capabilities;
});

connection.onInitialized(() => {});

connection.onRequest(Requests.setup, async () => {
  return await server.setup();
});

connection.onShutdown(() => server.shutdown());
connection.onExit(() => server.shutdown());

connection.listen();
