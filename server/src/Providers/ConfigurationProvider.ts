import { DidChangeConfigurationNotification, DidChangeConfigurationParams } from "vscode-languageserver";
import { ServerManager } from "../ServerManager";

type ConfigCallback = () => void;

export default class ConfigurationProvider {
  constructor(private readonly server: ServerManager, private readonly configChangeCallback: ConfigCallback) {
    this.server.connection.onDidChangeConfiguration(this.handleDidChangeConfiguration);
  }

  private async registerCallback() {
    await this.server.connection.client.register(DidChangeConfigurationNotification.type);
  }

  // This needs to be an arrow function to keep the context
  private readonly handleDidChangeConfiguration = (_: DidChangeConfigurationParams) => {
    this.configChangeCallback();
  };

  public static async register(server: ServerManager, configChangeCallback: ConfigCallback) {
    const provider = new this(server, configChangeCallback);
    await provider.registerCallback();

    return provider;
  }
}
