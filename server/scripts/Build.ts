import { buildSync } from "esbuild";
import type { BuildOptions, BuildResult } from "esbuild";
import { createRequire } from "module";
import { resolve } from "path";

const treeSitterPackage = "web-tree-sitter";
const treeSitterRuntime = createRequire(__filename).resolve(treeSitterPackage);

export function buildServerBundle<T extends BuildOptions>(options: T): BuildResult<T>;
export function buildServerBundle(options: BuildOptions) {
  return buildSync({
    ...options,
    bundle: true,
    platform: "node",
    format: "cjs",
    // Match the dependency's exported entry point to our CommonJS output.
    // Its ESM runtime uses import.meta.url, which cannot survive CJS bundling.
    alias: { ...options.alias, [treeSitterPackage]: treeSitterRuntime },
  });
}

if (require.main === module) {
  buildServerBundle({
    absWorkingDir: resolve(__dirname, "../.."),
    entryPoints: { server: "server/src/server.ts", indexer: "server/src/Documents/DocumentsIndexer.ts" },
    outdir: "server/out",
    sourcemap: true,
    external: ["vscode"],
  });
}
