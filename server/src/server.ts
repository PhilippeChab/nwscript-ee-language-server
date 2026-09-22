import { createConnection, ProposedFeatures, InitializeParams } from "vscode-languageserver/node";
import { ServerManager } from "./ServerManager";

const connection = createConnection(ProposedFeatures.all);

let server: ServerManager | undefined;

connection.onInitialize(async (params: InitializeParams) => {
  server = new ServerManager(connection, params);
  return (await server.initialize()).getCapabilities();
});

connection.onInitialized(() => {
  void server?.up().catch((error: Error) => connection.console.error(error.message));
});

connection.onShutdown(async () => await server?.down());
// The transport can close without an LSP exit notification. down() sends worker
// termination signals synchronously, even when process exit cannot await it.
process.once("exit", () => {
  void server?.down();
});

connection.listen();
