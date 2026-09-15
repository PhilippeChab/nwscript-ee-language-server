import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const directory = join(__dirname, "grammar");
const files = Object.fromEntries(
  ["grammar.js", "tree-sitter.json", "../../../resources/tree-sitter-nwscript.wasm"].map((file) => [
    file,
    createHash("sha256")
      .update(readFileSync(join(directory, file)))
      .digest("hex"),
  ]),
);
writeFileSync(join(directory, "build.json"), JSON.stringify({ treeSitterCli: "0.25.10", abi: 15, emscriptenImage: "emscripten/emsdk:4.0.4", files }, null, 2) + "\n");
