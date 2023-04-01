import { writeFileSync, readFileSync, readdirSync } from "fs";
import { normalize, join } from "path";

import { Tokenizer } from "../src/Tokenizer";
import { TokenizedScope } from "../src/Tokenizer/Tokenizer";

const generateDefinitions = async () => {
  const tokenizer = await new Tokenizer(true).loadGrammar();

  console.log("Generating nwscript.nss definitions ...");
  // const lib = readFileSync(normalize(join(__dirname, "./nwscript.nss"))).toString();

  // const definitions = tokenizer.tokenizeContent(lib, TokenizedScope.global);
  // writeFileSync(normalize(join(__dirname, "../resources/standardLibDefinitions.json")), JSON.stringify(definitions, null, 4));
  console.log("Done.");

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
      if (
        definitions.children.length === 0 &&
        definitions.complexTokens.length === 0 &&
        definitions.structComplexTokens.length === 0
      ) {
        return;
      }

      console.log(`Generating ${filename} ...`);
      filesCount++;
      writeFileSync(fileDestination, JSON.stringify(definitions, null, 4));
    }
  });
  console.log(`Generated ${filesCount} files.`);
  console.log("Done.");

  // Ideally this script would extract directly from the .bif file but meh.
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

generateDefinitions();
