#!/usr/bin/env node
import { createRequire } from "module";
import { join } from "path";
import { readFileSync } from "fs";

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  process.stdout.write("Usage: nwscript-ee-language-server [--stdio]\nRequires Node.js 24 or newer. Configuration is supplied by the LSP client.\n");
} else if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string };
  process.stdout.write(`${manifest.version}\n`);
} else if (args.length === 0 || (args.length === 1 && args[0] === "--stdio")) {
  if (!args.length) process.argv.push("--stdio");
  createRequire(__filename)("../server/out/server.js");
} else {
  process.stderr.write("Usage: nwscript-ee-language-server [--stdio | --help | --version]\n");
  process.exitCode = 1;
}
