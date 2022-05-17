import { writeFileSync, readFileSync } from "fs";
import { normalize, join } from "path";
import { Tokenizer } from "../src/Tokenizer";
import { TokenizedScope } from "../src/Tokenizer/Tokenizer";

const loadGrammar = async () => {
  const tokenizer = await new Tokenizer().loadGrammar();

  const lib = readFileSync(normalize(join(__dirname, "../resources/nwscript.nss"))).toString();

  const definitions = tokenizer.tokenizeContent(lib, TokenizedScope.global);
  writeFileSync(normalize(join(__dirname, "../resources/standardLibDefinitions.json")), JSON.stringify(definitions, null, 4));
};

loadGrammar();
