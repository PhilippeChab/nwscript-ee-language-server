/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";

const wasmBin = readFileSync(join(__dirname, "..", "resources", "onig.wasm")).buffer;

export default loadWASM(wasmBin).then(() => {
  return {
    createOnigScanner(patterns: string[]) {
      return new OnigScanner(patterns);
    },
    createOnigString(string: string) {
      return new OnigString(string);
    },
  };
});
