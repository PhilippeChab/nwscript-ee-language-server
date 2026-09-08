/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

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
