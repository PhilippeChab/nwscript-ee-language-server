import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind } from "vscode-languageserver";
import ParserService from "../src/Parser/ParserService";
import SyntaxDocument from "../src/Parser/SyntaxDocument";
import { CompletionItemBuilder } from "../src/Providers/Builders";

before(async () => await SyntaxDocument.loadGrammar(join(__dirname, "../resources")));

const document = (text: string, version = 1) => TextDocument.create("file:///parser-test.nss", "nwscript", version, text);
async function parse(t: { after: (cleanup: () => void) => void }, source: string) {
  const parsed = await SyntaxDocument.create(document(source));
  t.after(() => parsed.dispose());
  return parsed;
}

void test("indexes functions, constants, structs, includes, and entry points through the existing contract", async (t) => {
  const parsed = await parse(
    t,
    '#include "helper"\nstruct Data { int field; struct Data nested; };\nconst int VALUE = 1;\nint Fn(int value = 2);\nint Fn(int renamed) { int local = renamed; return local; }\nvoid main() {}\n',
  );
  assert.equal(parsed.rootNode.hasError, false);
  const index = parsed.getIndex();
  assert.deepEqual(index.children, ["helper"]);
  assert.deepEqual(index.includePositions, [{ line: 0, character: 0 }]);
  assert.deepEqual(
    index.globalDeclarations.map((token) => token.identifier),
    ["VALUE", "Fn"],
  );
  const fn = index.globalDeclarations.find((token) => token.tokenType === CompletionItemKind.Function);
  assert.ok(fn && "params" in fn);
  assert.equal(fn.implementation, true);
  assert.equal(fn.params[0].defaultValue, "2");
  assert.deepEqual(
    index.localDeclarations?.map((token) => token.identifier),
    ["renamed", "local"],
  );
  assert.deepEqual(
    index.structDeclarations[0].properties.map((token) => [token.identifier, token.valueType]),
    [
      ["field", "int"],
      ["nested", "Data"],
    ],
  );
  assert.deepEqual(
    index.entryPointDeclarations?.map((token) => token.identifier),
    ["main"],
  );
  assert.deepEqual(
    index.globalDeclarations.map((token) => CompletionItemBuilder.buildItem(token).label),
    ["VALUE", "Fn"],
  );
});

void test("does not index global initializer calls as function declarations", async (t) => {
  const parsed = await parse(
    t,
    'struct commandStruct { string name; };\nstruct commandStruct CommandStruct(string name);\nstruct commandStruct FIRST = CommandStruct("first");\nstruct commandStruct SECOND = CommandStruct("second");',
  );
  const index = parsed.getIndex();
  assert.deepEqual(
    index.globalDeclarations.map((token) => token.identifier),
    ["CommandStruct", "FIRST", "SECOND"],
  );
  assert.deepEqual(index.globalDeclarations[0].position, { line: 1, character: 21 });
});

for (const suffix of ["void Unfinished(", "struct Unfinished { int "]) {
  void test(`preserves complete declarations before ${suffix}`, async (t) => {
    const parsed = await parse(t, "int Good(int value) { return value; }\n" + suffix);
    assert.equal(parsed.rootNode.hasError, true);
    assert.deepEqual(
      parsed.getIndex().globalDeclarations.map((token) => token.identifier),
      ["Good"],
    );
  });
}

void test("keeps parameter scope inside multiline prototypes", async (t) => {
  const source = "string value;\nint Fn(\n int value\n);";
  const parsed = await parse(t, source);
  assert.equal(parsed.getVisibleLocals(document(source).positionAt(source.lastIndexOf("value") + 2))[0].valueType, "int");
});

void test("restores parameter visibility after an inner block", async (t) => {
  const source = "string value;void Fn(int value){{string value;string copy=value;}int after=value;}";
  const parsed = await parse(t, source);
  assert.equal(parsed.getVisibleLocals(document(source).positionAt(source.indexOf("copy=value") + 7)).find((token) => token.identifier === "value")?.valueType, "string");
  assert.equal(parsed.getVisibleLocals(document(source).positionAt(source.indexOf("after=value") + 8)).find((token) => token.identifier === "value")?.valueType, "int");
});

void test("indexes field declarations independently of same-named globals", async (t) => {
  const parsed = await parse(t, "string field;\nstruct Data { int field; };\nvoid main(){struct Data d;int n=(d).field;}");
  assert.equal(parsed.getIndex().structDeclarations[0].properties[0].valueType, "int");
  assert.deepEqual(parsed.getIndex().structDeclarations[0].properties[0].position, { line: 1, character: 18 });
  assert.equal(parsed.getIndex().memberReferences?.[0].identifier, "field");
});

void test("preserves parenthesized member context without falling back to a bare identifier", async (t) => {
  const source = "string x;void main(){vector v;float result=(v).x;}";
  const parsed = await parse(t, source);
  assert.deepEqual(parsed.getMemberPath(document(source).positionAt(source.lastIndexOf("x"))), []);
});

for (const [marked, identifier, activeParameter] of [
  ["void main(){First(1);Second(2,|3);}", "Second", 1],
  ["void main(){Outer(Inner(1,|2),3);}", "Inner", 1],
  ["void main(){Outer(Inner(1,2),|3);}", "Outer", 1],
] as const) {
  void test(`finds the enclosing signature for ${marked}`, async (t) => {
    const source = marked.replace("|", "");
    const parsed = await parse(t, source);
    assert.deepEqual(parsed.getCallContext(document(source).positionAt(marked.indexOf("|"))), { identifier, activeParameter });
  });
}

for (const marked of [
  'void main(){string s="Imp|";}',
  'void main(){string s=r"line\nImp|";}',
  'void main(){string s=R"double ""quote"" Imp|";}',
  'void main(){string s=r"unfinished Imp|',
  'void main(){int hash=h"Imp|";}',
  "void main(){ // Imp|\n}",
  "void main(){ /* Imp| */ }",
]) {
  void test(`recognizes string/comment context for ${JSON.stringify(marked)}`, async (t) => {
    const source = marked.replace("|", "");
    const parsed = await parse(t, source);
    assert.equal(parsed.isInCommentOrString(document(source).positionAt(marked.indexOf("|"))), true);
  });
}

void test("retains exact UTF-16 declaration positions after Unicode and CRLF", async (t) => {
  const source = '// é😀\r\nstring TEXT="é😀"; int AFTER=1;\r\n// Documented é😀\r\nvoid Fn();\r\n';
  const parsed = await parse(t, source);
  for (const token of parsed.getIndex().globalDeclarations) assert.deepEqual(token.position, document(source).positionAt(source.indexOf(token.identifier)));
  const fn = parsed.getIndex().globalDeclarations.find((token) => token.identifier === "Fn");
  assert.ok(fn && "comments" in fn);
  assert.deepEqual(fn.comments, ["// Documented é😀"]);
});

void test("updates incrementally through unfinished and repaired edits, including in-place TextDocument updates", async (t) => {
  const live = document("");
  const parsed = await SyntaxDocument.create(live);
  t.after(() => parsed.dispose());
  const source = 'struct Data { int field; };\r\nvoid Fn(int value){string s="é😀";int n=value;}';
  for (let length = 1; length <= source.length; length++) {
    TextDocument.update(live, [{ text: source.slice(0, length) }], length + 1);
    parsed.update(live);
    const fresh = await SyntaxDocument.create(document(source.slice(0, length)));
    try {
      assert.equal(parsed.rootNode.toString(), fresh.rootNode.toString());
      assert.deepEqual(parsed.getIndex(), fresh.getIndex());
    } finally {
      fresh.dispose();
    }
  }
  TextDocument.update(live, [{ text: "void Changed(){}" }], source.length + 2);
  parsed.update(live);
  assert.deepEqual(
    parsed.getIndex().globalDeclarations.map((token) => token.identifier),
    ["Changed"],
  );
});

void test("reads every upstream corpus fixture without syntax errors", async (t) => {
  const directory = join(__dirname, "../test/static/neverwinter/corpus");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".nss"))) {
    const parsed = await parse(t, readFileSync(join(directory, file), "utf8"));
    // Semantic-negative fixtures still have valid syntax. The compiler remains authoritative.
    assert.equal(parsed.rootNode.hasError, false, file);
  }
});

void test("recovers later declarations after an unfinished signature", async (t) => {
  const parsed = await parse(t, "void Broken(\nvoid Later(){}\nvoid main(){}");
  assert.equal(parsed.rootNode.hasError, true);
  assert.deepEqual(
    parsed.getIndex().entryPointDeclarations?.map((token) => token.identifier),
    ["main"],
  );
  assert.equal(
    parsed.getIndex().globalDeclarations.some((token) => token.identifier === "Later"),
    true,
  );
});

for (const source of ['void main(){string s="unfinished', 'void main(){int hash=h"unfinished']) {
  void test(`retains unfinished string context for ${source}`, async (t) => {
    const parsed = await parse(t, source);
    assert.equal(parsed.isInCommentOrString(document(source).positionAt(source.length)), true);
  });
}

void test("does not suppress signatures immediately after a completed string", async (t) => {
  const source = 'void main(){Fn("text",2);}';
  const parsed = await parse(t, source);
  const position = document(source).positionAt(source.indexOf(",2"));
  assert.equal(parsed.isInCommentOrString(position), false);
  assert.deepEqual(parsed.getCallContext(position), { identifier: "Fn", activeParameter: 0 });
});

void test("distinguishes the receiver from the member being accessed", async (t) => {
  const source = "void main(){vector v;float x=(v).x;}";
  const parsed = await parse(t, source);
  assert.equal(parsed.getMemberPath(document(source).positionAt(source.indexOf("(v)") + 1)), undefined);
});

void test("pins the generated WASM to the reviewed grammar sources", () => {
  const directory = join(__dirname, "grammar");
  const manifest = JSON.parse(readFileSync(join(directory, "build.json"), "utf8")) as { files: Record<string, string> };
  for (const file of ["grammar.js", "tree-sitter.json", "../../resources/tree-sitter-nwscript.wasm"]) {
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join(directory, file)))
        .digest("hex"),
      manifest.files[file],
      `${file}: rebuild the grammar and update its manifest`,
    );
  }
});

void test("shares syntax and indexes per live version while isolating different documents", async (t) => {
  const parserService = await new ParserService(true).loadGrammar();
  const first = document("int FIRST;");
  const second = TextDocument.create("file:///second.nss", "nwscript", 1, "int SECOND;");
  const parsed = parserService.parse(first);
  const other = parserService.parse(second);
  t.after(() => {
    parsed.dispose();
    other.dispose();
  });
  assert.notEqual(parsed, other);
  assert.equal(parserService.parse(first), parsed);
  assert.equal(parserService.getDocumentIndex(first), parsed.getIndex());
  const original = parsed.getIndex();
  TextDocument.update(first, [{ text: "int UPDATED;" }], 2);
  assert.equal(parserService.parse(first), parsed);
  assert.equal(parsed.getIndex().globalDeclarations[0].identifier, "UPDATED");
  assert.equal(original.globalDeclarations[0].identifier, "FIRST");
  assert.equal(other.getIndex().globalDeclarations[0].identifier, "SECOND");
});

void test("ships the WASM runtime from the pinned runtime dependency", () => {
  assert.deepEqual(readFileSync(join(__dirname, "../resources/web-tree-sitter.wasm")), readFileSync(join(__dirname, "../node_modules/web-tree-sitter/tree-sitter.wasm")));
});

const conformance = JSON.parse(readFileSync(join(__dirname, "conformance.json"), "utf8")) as {
  name: string;
  source: string;
  syntax: boolean;
  compiler: "successful" | "errored" | "skipped";
  category: string;
}[];
let compilerWorkspace: string;
before(() => {
  compilerWorkspace = mkdtempSync(join(tmpdir(), "nwscript parser conformance "));
  mkdirSync(join(compilerWorkspace, "ovr"));
  mkdirSync(join(compilerWorkspace, "lang/en"), { recursive: true });
  writeFileSync(join(compilerWorkspace, "databuild.txt"), "test\n");
  copyFileSync(join(__dirname, "compiler-language.nss"), join(compilerWorkspace, "ovr/nwscript.nss"));
  writeFileSync(join(compilerWorkspace, "ovr/helper.nss"), "void main(){}");
});
after(() => {
  if (compilerWorkspace) rmSync(compilerWorkspace, { recursive: true, force: true });
});
for (const fixture of conformance) {
  void test(`compiler-backed syntax: ${fixture.name}`, async (t) => {
    const parsed = await parse(t, fixture.source);
    assert.equal(!parsed.rootNode.hasError, fixture.syntax, parsed.rootNode.toString());
    const file = join(compilerWorkspace, "case.nss");
    writeFileSync(file, fixture.source);
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
    const executable = join(__dirname, "../resources/compiler", platform, `nwn_script_comp${process.platform === "win32" ? ".exe" : ""}`);
    const result = spawnSync(executable, ["-y", "-s", "-j", "1", "--userdirectory", compilerWorkspace, "--root", compilerWorkspace, "--dirs", compilerWorkspace, "-c", file], {
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, fixture.compiler === "errored" ? 1 : 0, result.stderr);
    assert.match(result.stderr, fixture.compiler === "skipped" ? /1 skipped/ : fixture.compiler === "successful" ? /1 successful/ : /1 errored/);
  });
}

for (const returnType of ["void", "int", "string", "struct Data"]) {
  for (const separator of [" ", "\n", "\r\n"]) {
    void test(`recovers a ${returnType} function after a damaged signature (${JSON.stringify(separator)})`, async (t) => {
      const body = returnType === "void" ? "" : returnType === "int" ? "return 1;" : returnType === "string" ? 'return "ok";' : "struct Data value; return value;";
      const source = `struct Data{int field;};\n${returnType} Broken(${separator}${returnType} Later(int parameter){${body}}\nvoid main(){Later(1);}`;
      const parsed = await parse(t, source);
      const later = parsed.getIndex().globalDeclarations.find((token) => token.identifier === "Later");
      assert.ok(later && "params" in later);
      assert.deepEqual(later.position, document(source).positionAt(source.indexOf("Later")));
      assert.equal(later.params[0].identifier, "parameter");
      assert.equal(later.implementation, true);
      assert.equal(
        parsed.getIndex().globalDeclarations.some((token) => token.identifier === "Broken"),
        false,
      );
      assert.throws(() => parsed.getIndex(true));
      const fixed = source.replace(`${returnType} Broken(${separator}`, "");
      parsed.update(document(fixed, 2));
      const fresh = await parse(t, fixed);
      assert.equal(parsed.rootNode.toString(), fresh.rootNode.toString());
      assert.deepEqual(parsed.getIndex(), fresh.getIndex());
    });
  }
}

void test("incremental edits after recovered signatures match fresh parsing", async (t) => {
  const source = "void Broken(\nvoid Later(int parameter){}\nvoid main(){Later(1);}";
  const parsed = await parse(t, source);
  for (let length = 0; length <= source.length; length++) {
    const edited = source.slice(0, length);
    parsed.update(document(edited, length + 2));
    const fresh = await parse(t, edited);
    assert.equal(parsed.rootNode.toString(), fresh.rootNode.toString(), edited);
    assert.deepEqual(parsed.getIndex(), fresh.getIndex(), edited);
  }
});

for (const comment of ["/* unfinished", "/** unfinished *", "/* unfinished **", "/* first */ /* second"]) {
  void test(`retains completion suppression inside ${comment}`, async (t) => {
    const source = `void main(){${comment}`;
    const parsed = await parse(t, source);
    assert.equal(parsed.isInCommentOrString(document(source).positionAt(source.length)), true);
  });
}

void test("matches fresh parsing through 805 damaged edit and restore sequences", () => {
  const seeds = [
    'struct Data { int value; };\nint Fn(struct Data data, int n = 0) { string unicode="😀"; return data.value + n; }\nvoid main() { struct Data data; Fn(data, 1); }',
    "int Broken(\nint Later(int parameter) { return parameter; }\nvoid main() { Later(1); }",
    'const string TEXT = r"raw ""text""";\r\nint Fn(int n) { /* comment */ return n; }',
  ];
  let count = 0;
  for (const seed of seeds) {
    const parsed = SyntaxDocument.create(document(seed));
    try {
      for (let start = 0; start < seed.length; start += 2) {
        for (const replacement of ["", "\n", "/*", "int ", '"']) {
          const modified = seed.slice(0, start) + replacement + seed.slice(Math.min(start + 3, seed.length));
          const live = document(modified, count + 2);
          parsed.update(live);
          const fresh = SyntaxDocument.create(live);
          try {
            assert.equal(parsed.rootNode.toString(), fresh.rootNode.toString());
            assert.deepEqual(parsed.getIndex(), fresh.getIndex());
            for (const offset of [0, start, modified.length]) {
              const position = live.positionAt(offset);
              assert.deepEqual(parsed.getLocalScope(position), fresh.getLocalScope(position));
              assert.deepEqual(parsed.getCallContext(position), fresh.getCallContext(position));
              assert.deepEqual(parsed.getMemberPath(position), fresh.getMemberPath(position));
              assert.deepEqual(parsed.getActionTarget(position), fresh.getActionTarget(position));
            }
          } finally {
            fresh.dispose();
          }
          parsed.update(document(seed, count + 3));
          count++;
        }
      }
    } finally {
      parsed.dispose();
    }
  }
  assert.equal(count, 805);
});

void test("keeps the prototype after a line comment ending in a backslash", async (t) => {
  const parsed = await parse(t, "// comment ending in \\\nint Fn(int publicName);\nint Fn(int internalName) { return internalName; }");
  const fn = parsed.getIndex().globalDeclarations[0];
  assert.ok(fn.tokenType === CompletionItemKind.Function);
  assert.deepEqual(fn.position, { line: 1, character: 4 });
  assert.equal(fn.params[0].identifier, "publicName");
});

void test("keeps a struct parameter following primitive parameters", async (t) => {
  const parsed = await parse(t, "struct Data { int value; };\nvoid Fn(object owner, int index, struct Data data);");
  const fn = parsed.getIndex().globalDeclarations[0];
  assert.ok(fn.tokenType === CompletionItemKind.Function);
  assert.deepEqual(
    fn.params.map((param) => [param.valueType, param.identifier]),
    [
      ["object", "owner"],
      ["int", "index"],
      ["Data", "data"],
    ],
  );
});
