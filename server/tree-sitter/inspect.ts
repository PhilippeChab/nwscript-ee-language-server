import { readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser from "../src/Language/Parser";

async function main() {
  const paths = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (!paths.length) throw new Error("Usage: yarn inspect [--tree] path/to/script.nss");
  const parser = await new Parser(true).loadGrammar();
  for (const path of paths) {
    const file = resolve(path);
    const text = readFileSync(file, "utf8");
    const parsed = parser.parse(TextDocument.create(pathToFileURL(file).href, "nwscript", 1, text));
    try {
      const index = parsed.getIndex();
      console.log(
        JSON.stringify(
          {
            file,
            hasSyntaxErrors: parsed.hasSyntaxErrors,
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
