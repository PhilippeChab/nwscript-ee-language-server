import { DidChangeConfigurationNotification, DidChangeConfigurationParams } from "vscode-languageserver";
import { ServerManager } from "../ServerManager";

type ConfigCallback = (settings: unknown) => void;

export default class ConfigurationProvider {
  constructor(private readonly server: ServerManager, private readonly configChangeCallback: ConfigCallback) {
    this.server.connection.onDidChangeConfiguration(this.handleDidChangeConfiguration);
  }

  public static async register(server: ServerManager, configChangeCallback: ConfigCallback) {
    const provider = new this(server, configChangeCallback);
    await provider.registerCallback();

    return provider;
  }

  // This needs to be an arrow function to keep the context
  private readonly handleDidChangeConfiguration = (params: DidChangeConfigurationParams) => {
    this.configChangeCallback(params.settings);
  };

  private async registerCallback() {
    if (this.server.capabilitiesHandler.getSupportsConfigurationRegistration()) {
      await this.server.optionalClientRequest("client/registerCapability", async () => await this.server.connection.client.register(DidChangeConfigurationNotification.type));
    }
  }
}
