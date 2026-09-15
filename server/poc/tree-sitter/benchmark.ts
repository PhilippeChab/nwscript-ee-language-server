import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import SyntaxDocument from "../../src/Tokenizer/SyntaxDocument";
import { TextDocument } from "vscode-languageserver-textdocument";
const doc = (text: string, version = 1) => TextDocument.create("file:///bench.nss", "nwscript", version, text);
async function main() {
  await SyntaxDocument.loadGrammar(join(__dirname, "../../resources"));
  const sources = process.argv.slice(2).map((file) => [file, readFileSync(file, "utf8")]);
  sources.push(["200 damaged signatures", Array.from({ length: 200 }, (_, i) => `int Broken${i}(\nint Later${i}(int parameter){return parameter;}\n`).join("")]);
  for (const [file, source] of sources) {
    const parses: number[] = [];
    const edits: number[] = [];
    const queries: number[] = [];
    let fnCount = 0;
    for (let i = 0; i < 35; i++) {
      let start = performance.now();
      const parsed = SyntaxDocument.create(doc(source));
      parsed.getIndex();
      const elapsed = performance.now() - start;
      if (i >= 5) parses.push(elapsed);
      fnCount = parsed.getIndex().globalDeclarations.length;
      const edited = source + "\n";
      start = performance.now();
      parsed.update(doc(edited, i + 2));
      parsed.getIndex();
      if (i >= 5) edits.push(performance.now() - start);
      start = performance.now();
      const pos = doc(edited).positionAt(edited.length);
      parsed.getLocalScope(pos);
      parsed.getActionTarget(pos);
      parsed.getCallContext(pos);
      if (i >= 5) queries.push(performance.now() - start);
      parsed.dispose();
    }
    const stats = (a: number[]) => {
      a.sort((a, b) => a - b);
      return { medianMs: +a[15].toFixed(2), p95Ms: +a[28].toFixed(2) };
    };
    console.log(JSON.stringify({ file, characters: source.length, declarations: fnCount, parseAndIndex: stats(parses), editAndIndex: stats(edits), contextQueries: stats(queries) }));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
