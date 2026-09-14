import type { ServerManager } from "../ServerManager";

export default class Provider {
  constructor(protected readonly server: ServerManager) {}

  protected getStandardLibComplexTokens(uri: string) {
    return this.server.standardLibrary.get(uri).complexTokens;
  }

  protected getStandardLibStructTokens(uri: string) {
    return this.server.standardLibrary.get(uri).structComplexTokens;
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
      this.server.logger.error("Unknown error, could not resolve the request.");

      // Uncomment this when deving
      // this.server.logger.error(e.message);
      // this.server.logger.error(e.stack);
    }
    return result || defaultResult;
  }

  public static register(server: ServerManager) {
    return new this(server);
  }
}
