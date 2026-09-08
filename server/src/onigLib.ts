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
