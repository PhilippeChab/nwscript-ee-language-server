import { buildServerBundle } from "./Build";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "fs";
import { join, resolve } from "path";
import { runNpm } from "./Npm";

type Manifest = { name: string; version: string; license: string; author: unknown; repository: unknown };

export function packageStandalone(): string {
  const root = resolve(__dirname, "../..");
  const output = join(root, "dist", "standalone");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Manifest;
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const build = buildServerBundle({
    absWorkingDir: root,
    entryPoints: { server: "server/src/server.ts", indexer: "server/src/Documents/DocumentsIndexer.ts" },
    outdir: join(output, "server", "out"),
    target: "node24",
    metafile: true,
  });
  for (const relative of ["server/resources", "syntaxes", "LICENSE"]) cpSync(join(root, relative), join(output, relative), { recursive: true });
  cpSync(join(root, "server", "README.md"), join(output, "README.md"));
  mkdirSync(join(output, "bin"));
  buildServerBundle({ entryPoints: [join(root, "server/src/cli.ts")], outfile: join(output, "bin/nwscript-ee-language-server.cjs"), target: "node24" });
  chmodSync(join(output, "bin", "nwscript-ee-language-server.cjs"), 0o755);
  for (const platform of ["linux", "mac"]) chmodSync(join(output, "server", "resources", "compiler", platform, "nwn_script_comp"), 0o755);

  // esbuild embeds runtime dependencies. Preserve their manifests and licenses,
  // including the WASM dependency whose binary is loaded as a resource.
  const dependencies = new Set<string>();
  for (const input of [...Object.keys(build.metafile.inputs), "server/node_modules/web-tree-sitter/tree-sitter.wasm"]) {
    const normalized = input.replace(/\\/g, "/");
    const marker = normalized.lastIndexOf("node_modules/");
    if (marker < 0) continue;
    const tail = normalized.slice(marker + "node_modules/".length).split("/");
    dependencies.add(normalized.slice(0, marker) + "node_modules/" + tail.slice(0, tail[0].startsWith("@") ? 2 : 1).join("/"));
  }
  for (const dependency of dependencies) {
    const directory = join(root, dependency);
    const info = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as Manifest;
    const destination = join(output, "third-party", info.name);
    mkdirSync(destination, { recursive: true });
    cpSync(join(directory, "package.json"), join(destination, "package.json"));
    for (const file of readdirSync(directory)) {
      if (/^(licen[sc]e|copying|notice)(\.|$)/i.test(file)) cpSync(join(directory, file), join(destination, file), { recursive: true });
    }
  }
  writeFileSync(
    join(output, "package.json"),
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        description: "Standalone NWScript EE language server for LSP clients",
        license: manifest.license,
        author: manifest.author,
        repository: manifest.repository,
        engines: { node: ">=24" },
        bin: { "nwscript-ee-language-server": "bin/nwscript-ee-language-server.cjs" },
        files: ["bin", "server", "syntaxes", "third-party", "LICENSE", "README.md"],
      },
      null,
      2,
    ) + "\n",
  );
  const packed = JSON.parse(runNpm(["pack", output, "--pack-destination", join(root, "dist"), "--json"], root)) as { filename: string }[];
  return join(root, "dist", packed[0].filename);
}

if (require.main === module) console.log(packageStandalone());
