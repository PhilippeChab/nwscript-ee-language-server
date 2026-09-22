import type { ServerManager } from "../ServerManager";

export default class Provider {
  constructor(protected readonly server: ServerManager) {}

  public static register(server: ServerManager) {
    return new this(server);
  }

  protected getDocument(uri: string) {
    const live = this.server.liveDocumentsManager.get(uri);
    if (!live) return;
    return this.server.documentsCollection.getDocument(live, this.server.parser, this.server.standardLibrary.get(uri), (owner) => this.server.liveDocumentsManager.get(owner));
  }

  protected exceptionsWrapper<N>(cb: () => N): N | undefined;
  protected exceptionsWrapper<N>(cb: () => N, defaultResult: N): N;
  protected exceptionsWrapper<N>(cb: () => N, defaultResult?: N): N | undefined {
    let result;
    try {
      result = cb();
    } catch (e: any) {
      this.reportError(e);
    }
    return result || defaultResult;
  }

  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>): Promise<N | undefined>;
  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>, defaultResult: N): Promise<N>;
  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>, defaultResult?: N): Promise<N | undefined> {
    let result;
    try {
      result = await cb();
    } catch (e: any) {
      this.reportError(e);
    }
    return result || defaultResult;
  }

  private reportError(error: unknown) {
    this.server.logger.error(`Could not resolve request: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}
