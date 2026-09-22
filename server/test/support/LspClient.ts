import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { once } from "events";
import { pathToFileURL } from "url";
import {
  createMessageConnection,
  IPCMessageReader,
  IPCMessageWriter,
  InitializeRequest,
  InitializedNotification,
  ShutdownRequest,
  ExitNotification,
  LogMessageNotification,
  PublishDiagnosticsNotification,
  ResponseError,
  ErrorCodes,
  type ClientCapabilities,
  type InitializeParams,
  type PublishDiagnosticsParams,
} from "vscode-languageserver/node";

export type ClientOptions = {
  capabilities?: ClientCapabilities;
  initializationOptions?: unknown;
  configuration?: () => unknown | Promise<unknown>;
  registration?: () => unknown | Promise<unknown>;
  progress?: () => unknown | Promise<unknown>;
  root?: string | null;
  legacyRoot?: boolean;
  defaultTransport?: boolean;
  ipc?: boolean;
};

export class LspClient {
  public readonly child: ChildProcessWithoutNullStreams;
  public readonly rpc;
  public readonly logs: string[] = [];
  public readonly requests: string[] = [];
  public readonly diagnostics: PublishDiagnosticsParams[] = [];
  public readonly protocolErrors: string[] = [];
  public stderr = "";
  private readonly closed: Promise<unknown[]>;

  constructor(
    cli: string,
    cwd: string,
    private readonly options: ClientOptions = {},
  ) {
    this.child = spawn(process.execPath, [cli, ...(options.ipc ? ["--node-ipc"] : options.defaultTransport ? [] : ["--stdio"])], {
      cwd,
      stdio: options.ipc ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.closed = once(this.child, "close");
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    this.rpc = options.ipc ? createMessageConnection(new IPCMessageReader(this.child), new IPCMessageWriter(this.child)) : createMessageConnection(this.child.stdout, this.child.stdin);
    this.rpc.onError(([error]) => this.protocolErrors.push(error.message));
    this.rpc.onNotification(LogMessageNotification.type, ({ message }) => this.logs.push(message));
    this.rpc.onNotification(PublishDiagnosticsNotification.type, (params) => this.diagnostics.push(params));
    this.rpc.onRequest(async (method: string) => {
      this.requests.push(method);
      switch (method) {
        case "workspace/configuration":
          if (options.capabilities?.workspace?.configuration) return [(await options.configuration?.()) ?? null];
          break;
        case "client/registerCapability":
          if (options.capabilities?.workspace?.didChangeConfiguration?.dynamicRegistration) return (await options.registration?.()) ?? null;
          break;
        case "window/workDoneProgress/create":
          if (options.capabilities?.window?.workDoneProgress) return (await options.progress?.()) ?? null;
          break;
      }
      this.protocolErrors.push(`Unexpected request ${method}`);
      throw new ResponseError(ErrorCodes.MethodNotFound, `Unsupported ${method}`);
    });
    this.rpc.listen();
  }

  public async initialize(workspace: string) {
    const root = this.options.root === undefined ? workspace : this.options.root;
    const params: InitializeParams = {
      processId: process.pid,
      rootUri: root && !this.options.legacyRoot ? pathToFileURL(root).href : null,
      capabilities: this.options.capabilities || {},
      initializationOptions: this.options.initializationOptions,
    };
    if (this.options.legacyRoot) params.rootPath = root;
    const result = await this.rpc.sendRequest(InitializeRequest.type, params);
    await this.rpc.sendNotification(InitializedNotification.type, {});
    return result;
  }

  public async waitFor(predicate: () => boolean, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (this.protocolErrors.length) throw new Error(this.protocolErrors.join("\n"));
      if (Date.now() > deadline || this.child.exitCode !== null) throw new Error(`Server did not reach expected state. ${this.logs.join("\n")}\n${this.stderr}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }

  public async ready() {
    await this.waitFor(() => this.logs.some((message) => message.startsWith("Indexed ")));
  }

  public async shutdown() {
    await this.rpc.sendRequest(ShutdownRequest.type);
    await this.rpc.sendNotification(ExitNotification.type);
    const [code] = await this.closed;
    if (code !== 0) throw new Error(`Server exited with ${String(code)}: ${this.stderr}`);
    if (this.protocolErrors.length) throw new Error(this.protocolErrors.join("\n"));
  }

  public async dispose() {
    this.rpc.dispose();
    if (this.child.exitCode === null) this.child.kill();
    await this.closed;
  }
}
