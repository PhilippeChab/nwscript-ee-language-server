import { DidChangeConfigurationNotification, DidChangeConfigurationParams } from "vscode-languageserver";
import { ServerManager } from "../ServerManager";

type ConfigCallback = () => void;

export default class ConfigurationProvider {
  public static register(server: ServerManager, configChangeCallback: ConfigCallback) {
    return new this(server, configChangeCallback);
  }

  constructor(private readonly server: ServerManager, private readonly configChangeCallback: ConfigCallback) {
    this.server.connection.client.register(DidChangeConfigurationNotification.type);
    this.server.connection.onDidChangeConfiguration(this.handleDidChangeConfiguration);
  }

  // This needs to be an arrow function to keeo the context
  private handleDidChangeConfiguration = (_: DidChangeConfigurationParams) => {
    this.configChangeCallback();
  };
}
