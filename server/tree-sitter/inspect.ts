import { readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import ParserService from "../src/Parser/ParserService";

async function main() {
  const paths = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (!paths.length) throw new Error("Usage: yarn inspect [--tree] path/to/script.nss");
  const parserService = await new ParserService(true).loadGrammar();
  for (const path of paths) {
    const file = resolve(path);
    const text = readFileSync(file, "utf8");
    const parsed = parserService.parse(TextDocument.create(pathToFileURL(file).href, "nwscript", 1, text));
    try {
      const index = parsed.getIndex();
      console.log(
        JSON.stringify(
          {
            file,
            hasSyntaxErrors: parsed.rootNode.hasError,
            index,
            ...(process.argv.includes("--tree") ? { tree: parsed.rootNode.toString() } : {}),
          },
          null,
          2,
        ),
      );
    } finally {
      parsed.dispose();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
