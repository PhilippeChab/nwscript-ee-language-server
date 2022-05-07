import { join } from "path";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";

import type { LanguageClientOptions } from "vscode-languageclient/node";
import type { ExtensionContext } from "vscode";

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
}

export function deactivate() {
  return client?.stop();
}
