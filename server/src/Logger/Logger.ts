import type { RemoteConsole } from "vscode-languageserver";

export default class Logger {
  constructor(private readonly console: RemoteConsole) {}

  debug(text: string) {
    this.console.debug(text);
  }

  info(text: string) {
    this.console.info(text);
  }

  error(text: string) {
    this.console.error(text);
  }
}
