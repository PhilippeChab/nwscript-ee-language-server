import { ServerManager } from "../ServerManager";

export default class Provider {
  public static register(server: ServerManager) {
    return new this(server);
  }

  constructor(protected readonly server: ServerManager) {}
}
