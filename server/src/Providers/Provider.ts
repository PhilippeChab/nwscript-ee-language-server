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
}
