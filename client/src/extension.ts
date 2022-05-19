import { join } from "path";
import { LanguageClient, ServerOptions, TransportKind } from "vscode-languageclient/node";

import type { LanguageClientOptions } from "vscode-languageclient/node";
import { ExtensionContext, ProgressLocation, window } from "vscode";

enum Requests {
  setup = "server/setup",
}

let client: LanguageClient;
const serverConfig = (serverPath: string) => {
  return { module: serverPath, transport: TransportKind.ipc };
};

export function activate(context: ExtensionContext) {
  const serverPath = context.asAbsolutePath(join("server", "out", "server.js"));
  const serverOptions: ServerOptions = {
    run: { ...serverConfig(serverPath) },
    debug: { ...serverConfig(serverPath), options: { execArgv: ["--nolazy", "--inspect=6009"] } },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "nwscript" }],
  };

  client = new LanguageClient("nwscript", "NWscript Language Server", serverOptions, clientOptions);
  client.registerProposedFeatures();
  client.start();

  client.onReady().then(() => {
    window.withProgress(
      {
        location: ProgressLocation.Window,
        cancellable: false,
        title: "Indexing files for NWScript: EE LSP ...",
      },
      async (progress) => {
        progress.report({ increment: 0 });

        await client.sendRequest(Requests.setup);

        progress.report({ increment: 100 });
      }
    );
  });
}

export function deactivate() {
  return client?.stop();
}
