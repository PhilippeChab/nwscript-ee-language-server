import { createConnection, ProposedFeatures, InitializeParams, WorkDoneProgressServerReporter } from "vscode-languageserver/node";
import { join } from "path";
import { Reply } from "zeromq";
import { cpus } from "os";
import * as clustering from "cluster";

import { ServerManager } from "./ServerManager";

export const SOCKET_ADRESS = "tcp://127.0.0.1:3021";

const socket = new Reply();
const connection = createConnection(ProposedFeatures.all);

const numCPUs = cpus().length;
const cluster = clustering.default;
if (cluster.isPrimary) {
  cluster.setupPrimary({
    exec: join(__dirname, "Documents", "DocumentsIndexer.js"),
  });
}

let server: ServerManager;
let progressReporter: WorkDoneProgressServerReporter;
let filesCount: number;
let filesIndexedCount = 0;

const ipcServerListen = async () => {
  for await (const [message] of socket) {
    const { filePath, globalScope } = JSON.parse(message.toString());
    server.documentsCollection?.createDocument(filePath, globalScope);
    filesIndexedCount++;
    progressReporter?.report(filesIndexedCount / filesCount!);
    await socket.send("OK");
  }
};

connection.onInitialize(async (params: InitializeParams) => {
  server = new ServerManager(connection, params);
  await server.initialize();
  await socket.bind(SOCKET_ADRESS);
  ipcServerListen();

  return server.getCapabilities();
});

connection.onInitialized(async () => {
  await server.up();

  const filesPath = server.workspaceFilesSystem.getAllFilesPath();
  filesCount = filesPath.length;

  progressReporter = await server.connection.window.createWorkDoneProgress();
  progressReporter.begin("Indexing files ...", 0);
  const partCount = filesCount / numCPUs;
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();
    worker.send(filesPath.slice(i * partCount, Math.min((i + 1) * partCount, filesCount - 1)).join(","));
  }

  cluster.on("exit", () => {
    if (Object.keys(cluster.workers || {}).length === 0) {
      socket.close();
      progressReporter?.done();
    }
  });
});

connection.onShutdown(() => server.down());
connection.onExit(() => server.down());

connection.listen();
