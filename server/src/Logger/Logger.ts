import type { RemoteConsole } from "vscode-languageserver";

export default class Logger {
  constructor(private readonly console: RemoteConsole) {}

  info(text: string) {
    this.console.info(text);
  }

  error(text: string) {
    this.console.error(text);
  }
}
