import { createConnection, ProposedFeatures, InitializeParams } from "vscode-languageserver/node";
import { fork } from "child_process";
import { join } from "path";

import { ServerManager } from "./ServerManager";

const connection = createConnection(ProposedFeatures.all);
let server: ServerManager;

connection.onInitialize(async (params: InitializeParams) => {
  server = new ServerManager(connection, params);

  await server.initialize();

  return server.getCapabilities();
});

connection.onInitialized(async () => {
  await server.up();

  server.logger.info("Indexing files ...");
  const child = fork(join(__dirname, "Documents", "DocumentsIndexer.js"), [server.workspaceFilesSystem.getWorkspaceRootPath()]);
  child.on("message", (message) => {
    server.documentsCollection?.initialize(JSON.parse(message.toString()));
    server.logger.info("Done");
  });
});

connection.onShutdown(() => server.down());
connection.onExit(() => server.down());

connection.listen();
