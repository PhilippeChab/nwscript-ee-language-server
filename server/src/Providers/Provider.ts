/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

import type { ServerManager } from "../ServerManager";

export default class Provider {
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

  public static register(server: ServerManager) {
    return new this(server);
  }
}
