import { readFileSync } from "fs";
import { ParserService } from "../Parser";
import { AnalysisMode, DocumentIndex } from "../Parser/ParserService";

export type IndexerMessage = { filePath: string; documentIndex?: DocumentIndex; error?: string };

const send = async (message: IndexerMessage) => {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) return reject(new Error("Indexer requires an IPC channel"));
    process.send(message, (error: Error | null) => (error ? reject(error) : resolve()));
  });
};

process.once("message", (paths: string[]) => {
  void (async () => {
    const parserService = await new ParserService().loadGrammar();
    for (const filePath of paths) {
      let message: IndexerMessage;
      try {
        const documentIndex = parserService.analyzeContent(readFileSync(filePath, "utf8"), AnalysisMode.document);
        message = { filePath, documentIndex };
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
