// Compare the same parser/index/hover-context work against a separate TextMate checkout.
// Five warmups, twenty samples; excludes startup and provider include traversal.
const fs = require("fs"),
  path = require("path"),
  { performance } = require("perf_hooks");
const current = path.resolve(__dirname, "../..");
if (!process.argv[2]) throw new Error("Usage: node compare.cjs /path/to/main-checkout /absolute/path/to/source.nss ...");
const old = path.resolve(process.argv[2]);
if (old === current) throw new Error("Baseline must be a separate checkout with its own dependencies installed");
const { buildSync } = require(current + "/node_modules/esbuild");
for (const dir of [old, current])
  buildSync({
    stdin: { contents: "export {Tokenizer} from './Tokenizer';", resolveDir: dir + "/server/src", loader: "ts" },
    outfile: dir + "/server/out/performance-review.js",
    bundle: true,
    platform: "node",
  });
const { TextDocument } = require(current + "/server/node_modules/vscode-languageserver-textdocument");
const cases = [
  ...process.argv.slice(3).map((file) => [path.basename(file), fs.readFileSync(file, "utf8")]),
  ["200 interrupted declarations", Array.from({ length: 200 }, (_, i) => `int Broken${i}(\nint Later${i}(int parameter){return parameter;}\n`).join("")],
];
const stats = (a) => {
  a.sort((a, b) => a - b);
  return { median: +a[Math.floor(a.length / 2)].toFixed(2), p95: +a[Math.floor(a.length * 0.95)].toFixed(2) };
};
(async () => {
  for (const dir of [old, current]) {
    const tokenizer = await new (require(dir + "/server/out/performance-review.js").Tokenizer)().loadGrammar();
    const tree = !!tokenizer.parse;
    for (const [name, source] of cases) {
      const cold = [],
        warm = [],
        edits = [];
      for (let i = 0; i < 25; i++) {
        const doc = TextDocument.create("file:///benchmark.nss", "nwscript", i + 1, source);
        const run = () => {
          const pos = doc.positionAt(doc.getText().length);
          if (tree) {
            const syntax = tokenizer.parse(doc);
            syntax.getIndex();
            syntax.getLocalScope(pos);
            syntax.getMemberPath(pos);
            syntax.getActionTarget(pos);
          } else {
            const [lines, raw] = tokenizer.tokenizeContentToRaw(doc.getText());
            tokenizer.tokenizeDocumentFromRaw(lines, raw);
            tokenizer.tokenizeContentFromRaw(lines, raw, 0, pos.line, pos.character);
            tokenizer.getMemberAccessFromRaw(lines, raw, pos);
            tokenizer.getActionTargetAtPosition(lines, raw, pos);
          }
        };
        let start = performance.now();
        run();
        if (i >= 5) cold.push(performance.now() - start);
        start = performance.now();
        run();
        if (i >= 5) warm.push(performance.now() - start);
        TextDocument.update(doc, [{ text: source + " " }], i + 30);
        start = performance.now();
        run();
        if (i >= 5) edits.push(performance.now() - start);
        if (tree) tokenizer.parse(doc).dispose();
      }
      console.log(JSON.stringify({ parser: tree ? "tree-sitter" : "textmate", name, characters: source.length, cold: stats(cold), warm: stats(warm), edit: stats(edits) }));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
