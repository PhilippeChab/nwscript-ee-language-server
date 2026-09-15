import { writeFileSync, readFileSync, readdirSync } from "fs";
import { normalize, join } from "path";
import { createHash } from "crypto";

import { extractSources, SourceMetadata } from "./UpdateStandardLibrary";

import { Tokenizer } from "../src/Tokenizer";
import { TokenizationMode } from "../src/Tokenizer/Tokenizer";

const generateDefinitions = async () => {
  const args = process.argv.slice(2);
  const archiveIndex = args.indexOf("--archive");
  const archivePath = archiveIndex >= 0 ? args.splice(archiveIndex, 2)[1] : undefined;
  if ((archiveIndex >= 0 && !archivePath) || args.some((arg) => arg !== "--standard-only" && arg !== "--check")) {
    throw new Error("Usage: generate-lib-defs [--standard-only] [--check] [--archive path.zip]");
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

  if (archivePath) {
    const targets = ["base_scripts", "ovr"].flatMap((folder) =>
      readdirSync(join(__dirname, "../resources", folder)).map((filename) => ({
        name: filename.slice(0, -5),
        destination: join(__dirname, "../resources", folder, filename),
      })),
    );
    const sources = extractSources(
      readFileSync(archivePath),
      metadata,
      targets.map((target) => target.name),
    );
    // Parse every source before updating any generated index.
    const updates = targets.map(({ name, destination }) => {
      const text = sources.get(name);
      if (!text) throw new Error(`Missing bundled script: ${name}`);
      return { destination, output: JSON.stringify(tokenizer.tokenizeContent(text.toString("utf8"), TokenizationMode.document), null, 4) };
    });
    for (const { destination, output } of updates) {
      if (check) {
        if (readFileSync(destination, "utf8") !== output) throw new Error(`Bundled definitions are stale: ${destination}`);
      } else writeFileSync(destination, output);
    }
    console.log(`${check ? "Verified" : "Generated"} ${updates.length} bundled script indexes from ${metadata.version}.`);
    return;
  }

  const definitions = tokenizer.tokenizeContent(lib, TokenizationMode.document);
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
      const definitions = tokenizer.tokenizeContent(lib, TokenizationMode.document);
      if (definitions.children.length === 0 && definitions.globalDeclarations.length === 0 && definitions.structDeclarations.length === 0) {
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
    const definitions = tokenizer.tokenizeContent(lib, TokenizationMode.document);

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
