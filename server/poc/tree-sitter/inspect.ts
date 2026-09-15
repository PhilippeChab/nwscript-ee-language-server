import { readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import TreeSitterDocument from "./TreeSitterDocument";
import Tokenizer from "../../src/Tokenizer/Tokenizer";

async function main() {
  const paths = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (!paths.length) throw new Error("Usage: yarn inspect [--compare] [--tree] path/to/script.nss");
  const tokenizer = process.argv.includes("--compare") ? await new Tokenizer(true).loadGrammar() : undefined;
  for (const path of paths) {
    const file = resolve(path);
    const text = readFileSync(file, "utf8");
    const parsed = await TreeSitterDocument.create(TextDocument.create(pathToFileURL(file).href, "nwscript", 1, text));
    try {
      const index = parsed.getIndex();
      const previous = tokenizer?.tokenizeDocumentFromRaw(...tokenizer.tokenizeContentToRaw(text));
      console.log(
        JSON.stringify(
          {
            file,
            hasSyntaxErrors: parsed.rootNode.hasError,
            index,
            ...(previous ? { previousIndex: previous } : {}),
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
