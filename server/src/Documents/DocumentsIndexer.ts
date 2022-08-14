import { readFileSync } from "fs";
import { exit } from "process";

import { Tokenizer } from "../Tokenizer";
import { TokenizedScope } from "../Tokenizer/Tokenizer";

const generateTokens = async (filesPath: string[]) => {
  if (filesPath.length === 1 && !Boolean(filesPath[0])) {
    exit(0);
  }

  const tokenizer = await new Tokenizer().loadGrammar();

  for (let i = 0; i < filesPath.length; i++) {
    const filePath = filesPath[i];
    if (filePath.includes("nwscript.nss")) {
      continue;
    }

    const fileContent = readFileSync(filePath).toString();
    const globalScope = tokenizer.tokenizeContent(fileContent, TokenizedScope.global);

    process?.send!(JSON.stringify({ filePath, globalScope }));
  }

  exit(0);
};

process.on("message", (filesPath: string) => {
  generateTokens(filesPath.split(","));
});
