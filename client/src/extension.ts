import { join } from "path";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";

import type { LanguageClientOptions } from "vscode-languageclient/node";
import { ExtensionContext, ProgressLocation, window } from "vscode";

let client: LanguageClient;
const serverConfig = (serverPath: string) => {
  return { module: serverPath, transport: TransportKind.ipc };
};

export function activate(context: ExtensionContext) {
  const serverPath = context.asAbsolutePath(join("server", "out", "server.js"));
  const serverOptions = {
    run: { ...serverConfig(serverPath) },
    debug: { ...serverConfig(serverPath), options: { execArgv: ["--nolazy", "--inspect=6009"] } },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "nwscript" }],
  };

  client = new LanguageClient("nwscript", "NWscript Language Server", serverOptions, clientOptions);
  client.start();

  window.withProgress(
    {
      location: ProgressLocation.Window,
      cancellable: false,
      title: "Indexing files for NWScript: EE LSP ...",
    },
    async (progress) => {
      progress.report({ increment: 0 });

      await client.onReady();

      progress.report({ increment: 100 });
    }
  );
}

export function deactivate() {
  return client?.stop();
}
