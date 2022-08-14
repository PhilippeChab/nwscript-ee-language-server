import { join } from "path";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { WorkspaceFilesSystem } from "./WorkspaceFilesSystem";

const wasmBin = WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "resources", "onig.wasm")).buffer;

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
