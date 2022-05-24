import { createConnection, ProposedFeatures, InitializeParams } from "vscode-languageserver/node";
import { fork } from "child_process";
import { join } from "path";
import { Reply } from "zeromq";

import { ServerManager } from "./ServerManager";

const sock = new Reply();
const connection = createConnection(ProposedFeatures.all);

let server: ServerManager;
let nbFilesIndexed = 0;

const ipcServerListen = async () => {
  for await (const [message] of sock) {
    const { filePath, globalScope } = JSON.parse(message.toString());
    server.documentsCollection?.createDocument(filePath, globalScope);
    nbFilesIndexed++;
    await sock.send("OK");
  }
};

connection.onInitialize(async (params: InitializeParams) => {
  server = new ServerManager(connection, params);
  await server.initialize();
  await sock.bind("tcp://127.0.0.1:3001");
  ipcServerListen();

  return server.getCapabilities();
});

connection.onInitialized(async () => {
  await server.up();

  server.logger.info("Indexing files ...");
  const child = fork(join(__dirname, "Documents", "DocumentsIndexer.js"), [server.workspaceFilesSystem.getWorkspaceRootPath()]);

  child.on("exit", () => {
    sock.close();
    server.logger.info(`Indexed ${nbFilesIndexed} files.`);
    server.logger.info("Done.");
  });
});

connection.onShutdown(() => server.down());
connection.onExit(() => server.down());

connection.listen();
