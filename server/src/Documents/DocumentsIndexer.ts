import { readFileSync } from "fs";
import { Tokenizer } from "../Tokenizer";
import { TokenizedScope, GlobalScopeTokenizationResult } from "../Tokenizer/Tokenizer";

export type IndexerMessage = { filePath: string; globalScope?: GlobalScopeTokenizationResult; error?: string };

const send = async (message: IndexerMessage) => {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) return reject(new Error("Indexer requires an IPC channel"));
    process.send(message, (error: Error | null) => (error ? reject(error) : resolve()));
  });
};

process.once("message", (paths: string[]) => {
  void (async () => {
    const tokenizer = await new Tokenizer().loadGrammar();
    for (const filePath of paths) {
      let message: IndexerMessage;
      try {
        const globalScope = tokenizer.tokenizeContent(readFileSync(filePath, "utf8"), TokenizedScope.global);
        message = { filePath, globalScope };
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
