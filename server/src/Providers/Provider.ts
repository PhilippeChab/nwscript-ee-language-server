import { ServerManager } from "../ServerManager";

export default class Provider {
  static register(server: ServerManager) {
    return new this(server);
  }

  constructor(protected readonly server: ServerManager) {}
}
