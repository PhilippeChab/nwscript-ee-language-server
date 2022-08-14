import { writeFileSync, readFileSync } from "fs";
import { normalize, join } from "path";

import { Tokenizer } from "../src/Tokenizer";
import { TokenizedScope } from "../src/Tokenizer/Tokenizer";

const generateDefinitions = async () => {
  const tokenizer = await new Tokenizer(true).loadGrammar();

  const lib = readFileSync(normalize(join(__dirname, "./nwscript.nss"))).toString();

  const definitions = tokenizer.tokenizeContent(lib, TokenizedScope.global);
  writeFileSync(normalize(join(__dirname, "../resources/standardLibDefinitions.json")), JSON.stringify(definitions, null, 4));
};

generateDefinitions();
