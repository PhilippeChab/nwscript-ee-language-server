import { writeFileSync, readFileSync, readdirSync } from "fs";
import { normalize, join } from "path";
import { createHash } from "crypto";

import type { SourceMetadata } from "./UpdateStandardLibrary";

import { Tokenizer } from "../src/Tokenizer";
import { TokenizedScope } from "../src/Tokenizer/Tokenizer";

const generateDefinitions = async () => {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--standard-only" && arg !== "--check")) {
    throw new Error("Usage: generate-lib-defs [--standard-only] [--check]");
  }
  const check = args.includes("--check");
  const tokenizer = await new Tokenizer(true).loadGrammar();

  console.log("Generating nwscript.nss definitions ...");
  const source = readFileSync(join(__dirname, "nwscript.nss"));
  const metadata: SourceMetadata = JSON.parse(readFileSync(join(__dirname, "../resources/standardLibSource.json"), "utf8"));
  if (createHash("sha256").update(source).digest("hex") !== metadata.sourceSha256) {
    throw new Error("nwscript.nss does not match standardLibSource.json. Fetch the pinned source or update its provenance first.");
  }
  const lib = source.toString("utf8");

  const definitions = tokenizer.tokenizeContent(lib, TokenizedScope.global);
  const destination = join(__dirname, "../resources/standardLibDefinitions.json");
  const output = JSON.stringify(definitions, null, 4);
  if (check) {
    if (readFileSync(destination, "utf8") !== output) {
      throw new Error("Bundled standard library is stale. Run generate-lib-defs --standard-only.");
    }
    console.log(`Bundled definitions match ${metadata.version}.`);
    return;
  }
  writeFileSync(destination, output);
  console.log("Done.");
  if (args.includes("--standard-only")) return;

  // Ideally this script would extract directly from the .bif file but meh.
  console.log("Generating base_scripts.bif definitions ...");
  let filesCount = 0;
  let directoryPath = normalize(join(__dirname, "base_scripts"));
  let files = readdirSync(directoryPath);

  files.forEach((filename) => {
    const fileSource = join(normalize(join(__dirname, "base_scripts", filename)));
    const fileDestination = join(normalize(join(__dirname, "../resources/base_scripts", filename.replace(".nss", ".json"))));
    const lib = readFileSync(fileSource).toString();

    // Skip main files
    if (!lib.includes("main")) {
      const definitions = tokenizer.tokenizeContent(lib, TokenizedScope.global);
      if (definitions.children.length === 0 && definitions.complexTokens.length === 0 && definitions.structComplexTokens.length === 0) {
        return;
      }

      console.log(`Generating ${filename} ...`);
      filesCount++;
      writeFileSync(fileDestination, JSON.stringify(definitions, null, 4));
    }
  });
  console.log(`Generated ${filesCount} files.`);
  console.log("Done.");

  console.log("Generating ovr includes definitions ...");
  filesCount = 0;
  directoryPath = normalize(join(__dirname, "ovr"));
  files = readdirSync(directoryPath);

  files.forEach((filename) => {
    const fileSource = join(normalize(join(__dirname, "ovr", filename)));
    const fileDestination = join(normalize(join(__dirname, "../resources/ovr", filename.replace(".nss", ".json"))));
    const lib = readFileSync(fileSource).toString();
    const definitions = tokenizer.tokenizeContent(lib, TokenizedScope.global);

    console.log(`Generating ${filename} ...`);
    filesCount++;
    writeFileSync(fileDestination, JSON.stringify(definitions, null, 4));
  });
  console.log(`Generated ${filesCount} files.`);
  console.log("Done.");
};

generateDefinitions().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
