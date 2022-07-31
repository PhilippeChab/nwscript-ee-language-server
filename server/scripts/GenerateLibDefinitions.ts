import { writeFileSync, readFileSync } from "fs";
import { normalize, join } from "path";
import { Tokenizer } from "../src/Tokenizer";
import { TokenizedScope } from "../src/Tokenizer/Tokenizer";
import { argv } from 'node:process';

const generateDefinitions = async () => {
  const tokenizer = await new Tokenizer().loadGrammar();
  const pathIndex = process.argv.indexOf('--path');
  let pathValue;

  if (pathIndex > -1) {
    pathValue = join(process.argv[pathIndex + 1], "/ovr");
  }

  const lib = readFileSync(normalize(join((pathValue || "../resources"), "/nwscript.nss"))).toString();
  const definitions = tokenizer.tokenizeContent(lib, TokenizedScope.global);

  writeFileSync(normalize(join(__dirname, "../resources/standardLibDefinitions.json")), JSON.stringify(definitions, null, 4));
};

generateDefinitions();
