import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import ClangFormatter from "../src/Providers/Formatters/ClangFormatter";

const childProcess = require("child_process");
const originalSpawn = childProcess.spawn;
const testUri = pathToFileURL(resolve("test.nss")).href;

describe("Formatter Unicode offsets", () => {
  afterEach(() => { childProcess.spawn = originalSpawn; });

  function mockCompiler(xml: string, inspect: (args: string[], input: string) => void = () => {}) {
    childProcess.spawn = (_executable: string, args: string[]) => {
      const child = new EventEmitter() as any;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let input = "";
      child.stdin.on("data", (chunk: Buffer) => { input += chunk.toString(); });
      child.stdin.on("finish", () => process.nextTick(() => {
        inspect(args, input);
        // Deliberately split UTF-8 sequences across process output chunks.
        for (const byte of Buffer.from(xml)) child.stdout.write(Buffer.from([byte]));
        child.stdout.end();
        child.emit("close", 0);
      }));
      return child;
    };
  }

  function formatter() {
    return new ClangFormatter({ getWorkspaceRootPath: () => process.cwd() } as any,
      true, false, [], "clang-format", {}, { info: () => {}, error: () => {} } as any);
  }

  it("applies byte-offset replacements after NWN color codes without deleting code", async () => {
    const source = '// "<c ¤|>"\r\n// "<c ¥ÿ>"\r\n// "<c¡¡¡>"\r\n// "<cÔ ¶>"\r\n// "<c|  >"\r\n// "<cÿ? >"\r\n// 😀\r\nvoid testFunction() {int nFoo=1;}\r\n';
    const document = TextDocument.create(testUri, "nwscript", 1, source);
    const offset = source.indexOf("=1");
    mockCompiler(`<replacements><replacement offset="${Buffer.byteLength(source.slice(0, offset))}" length="1"> = </replacement></replacements>`);
    const edits = await formatter().formatDocument(document, null);
    expect(TextDocument.applyEdits(document, edits!)).to.equal(source.replace("=1", " = 1"));
  });

  it("converts selection offsets and lengths to UTF-8 bytes", async () => {
    const source = '// ¥😀\nvoid main() { string s="¤😀"; }\n';
    const document = TextDocument.create(testUri, "nwscript", 1, source);
    const start = source.indexOf("¤");
    const end = start + "¤😀".length;
    mockCompiler("<replacements/>", (args, input) => {
      expect(input).to.equal(source);
      expect(args).to.include(`-offset=${Buffer.byteLength(source.slice(0, start))}`);
      expect(args).to.include(`-length=${Buffer.byteLength("¤😀")}`);
    });
    await formatter().formatDocument(document, { start: document.positionAt(start), end: document.positionAt(end) });
  });

  it("preserves Unicode replacement text and measures replacement lengths in bytes", async () => {
    const source = 'void main() { string s="¥😀"; }';
    const document = TextDocument.create(testUri, "nwscript", 1, source);
    const offset = Buffer.byteLength(source.slice(0, source.indexOf("¥")));
    mockCompiler(`<replacements><replacement offset="${offset}" length="${Buffer.byteLength("¥😀")}">¤😀</replacement></replacements>`);
    const edits = await formatter().formatDocument(document, null);
    expect(TextDocument.applyEdits(document, edits!)).to.equal(source.replace("¥😀", "¤😀"));
  });
});
