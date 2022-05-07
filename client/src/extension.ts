import { join } from "path";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";

import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import type { ExtensionContext } from "vscode";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  const serverModule = context.asAbsolutePath(join("server", "out", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "nwscript" }],
  };

  new LanguageClient("nwscript-ee", "NWscript Language Server", serverOptions, clientOptions).start();
}

export function deactivate() {
  if (!client) {
    return undefined;
  }

  return client.stop();
}
