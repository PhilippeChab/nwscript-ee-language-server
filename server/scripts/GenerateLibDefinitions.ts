import { writeFileSync, readFileSync } from "fs";
import { normalize } from "path";
import { Tokenizer } from "../src/tokenizer";

const loadGrammar = async () => {
  const tokenizer = await new Tokenizer().loadGrammar();

  const lib = readFileSync(
    normalize("/Users/Philippe/Documents/Repos/Personal/nwscript-ee/server/resources/nwscript.nss")
  ).toString();

  const definitions = tokenizer.retrieveGlobalDefinitions(lib);
  writeFileSync(
    normalize("/Users/Philippe/Documents/Repos/Personal/nwscript-ee/server/resources/standardLibDefinitions.json"),
    JSON.stringify(definitions, null, 4)
  );
};

loadGrammar();
