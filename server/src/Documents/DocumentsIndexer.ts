import { TextDocument } from "vscode-languageserver-textdocument";
import { pathToFileURL } from "url";
import { readFileSync } from "fs";
import Parser from "../Language/Parser";
import type { SyntaxIndex } from "../Language";

export type IndexerMessage = { filePath: string; syntaxIndex?: SyntaxIndex; error?: string };

const send = async (message: IndexerMessage) => {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) return reject(new Error("Indexer requires an IPC channel"));
    process.send(message, (error: Error | null) => (error ? reject(error) : resolve()));
  });
};

process.once("message", (paths: string[]) => {
  void (async () => {
    const parser = await new Parser().loadGrammar();
    for (const filePath of paths) {
      let message: IndexerMessage;
      try {
        const syntaxIndex = parser.indexContent(TextDocument.create(pathToFileURL(filePath).href, "nwscript", 0, readFileSync(filePath, "utf8")));
        message = { filePath, syntaxIndex };
      } catch (error) {
        message = { filePath, error: error instanceof Error ? error.message : String(error) };
      }
      await send(message);
    }
    process.disconnect?.();
  })().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
    process.disconnect?.();
  });
});
