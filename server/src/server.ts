import { createConnection, ProposedFeatures, InitializeParams, WorkDoneProgressServerReporter } from "vscode-languageserver/node";
import { join } from "path";
import { cpus } from "os";
import * as clustering from "cluster";
import { ServerManager } from "./ServerManager";

const connection = createConnection(ProposedFeatures.all);

const numCPUs = cpus().length;
const cluster = clustering.default;
if (cluster.isPrimary) {
  cluster.setupPrimary({
    exec: join(__dirname, "indexer.js"),
  });
}

let server: ServerManager;
let progressReporter: WorkDoneProgressServerReporter;
let filesCount: number;
let filesIndexedCount = 0;

connection.onInitialize(async (params: InitializeParams) => {
  server = new ServerManager(connection, params);
  await server.initialize();

  return server.getCapabilities();
});

connection.onInitialized(async () => {
  await server.up();

  const filesPath = server.workspaceFilesSystem.getAllFilesPath();
  filesCount = filesPath.length;

  progressReporter = await server.connection.window.createWorkDoneProgress();
  progressReporter.begin("Indexing files for NWScript: EE LSP ...", 0);
  const partCount = filesCount / numCPUs;
  for (let i = 0; i < Math.min(numCPUs, filesCount); i++) {
    const worker = cluster.fork();
    worker.send(filesPath.slice(i * partCount, Math.min((i + 1) * partCount, filesCount - 1)).join(","));
    worker.on("message", (message: string) => {
      const { filePath, globalScope } = JSON.parse(message);
      server.documentsCollection?.createDocument(filePath, globalScope);
      filesIndexedCount++;
      progressReporter?.report(filesIndexedCount / filesCount!);
    });
  }

  cluster.on("exit", async () => {
    if (Object.keys(cluster.workers || {}).length === 0) {
      progressReporter?.done();
      server.hasIndexedDocuments = true;
      await server.diagnosticsProvider?.processDocumentsWaitingForPublish();
    }
  });
});

connection.onShutdown(() => server.down());
connection.onExit(() => server.down());

connection.listen();
