import type { ServerManager } from "../ServerManager";

export default class Provider {
  public static register(server: ServerManager) {
    return new this(server);
  }

  constructor(protected readonly server: ServerManager) {}

  protected getStandardLibComplexTokens() {
    const documentCollection = this.server.documentsCollection;

    if (documentCollection) {
      return documentCollection.standardLibComplexTokens;
    }

    return [];
  }

  protected exceptionsWrapper<N>(cb: () => N): N | undefined;
  protected exceptionsWrapper<N>(cb: () => N, defaultResult: N): N;
  protected exceptionsWrapper<N>(cb: () => N, defaultResult?: N): N | undefined {
    let result;
    try {
      result = cb();
    } catch (e: any) {
      this.server.logger.error("Unknown error, could not resolve the request.");

      // Uncomment this when deving
      // this.server.logger.error(e.message);
      // this.server.logger.error(e.stack);
    } finally {
      return result || defaultResult;
    }
  }

  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>): Promise<N | undefined>;
  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>, defaultResult: N): Promise<N>;
  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>, defaultResult?: N): Promise<N | undefined> {
    let result;
    try {
      result = await cb();
    } catch (e: any) {
      this.server.logger.error("Unknown error, could not resolve the request.");

      // Uncomment this when deving
      // this.server.logger.error(e.message);
      // this.server.logger.error(e.stack);
    } finally {
      return result || defaultResult;
    }
  }
}
