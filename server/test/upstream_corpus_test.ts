import { after, before, describe, it } from "mocha";
import { expect } from "chai";
import { buildSync } from "esbuild";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { TextDocument } from "vscode-languageserver-textdocument";
import { workspaceUri } from "./support/fixtures";

// Original upstream programs and provenance are in static/neverwinter/README.md.
describe("neverwinter.nim compiler corpus", function () {
  this.timeout(30000);
  const fixtures = join(__dirname, "static/neverwinter");
  const files = readdirSync(join(fixtures, "corpus"))
    .filter((file) => file.endsWith(".nss"))
    .sort();
  let workspace: string;
  let api: any;
  let parserService: any;

  before(async () => {
    const bundle = join(__dirname, "../out/upstream-corpus-test.js");
    buildSync({
      stdin: {
        contents: `export { ParserService } from './Parser';
          export { default as Collection } from './Documents/DocumentsCollection';
          export { default as Hover } from './Providers/HoverContentProvider';
          export { default as Definition } from './Providers/GotoDefinitionProvider';
          export { defaultServerConfiguration as config } from './ServerManager/Config';`,
        resolveDir: join(__dirname, "../src"),
        loader: "ts",
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
    });
    api = require(bundle);
    parserService = await new api.ParserService().loadGrammar();
    workspace = mkdtempSync(join(tmpdir(), "nwscript upstream "));
    mkdirSync(join(workspace, "ovr"));
    mkdirSync(join(workspace, "lang/en"), { recursive: true });
    writeFileSync(join(workspace, "databuild.txt"), "test\n");
    copyFileSync(join(fixtures, "nwtestvmscript.nss"), join(workspace, "ovr/nwscript.nss"));
    for (const file of files) copyFileSync(join(fixtures, "corpus", file), join(workspace, file));
  });

  after(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  const compile = (file: string, requireEntryPoint: boolean) => {
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
    const executable = join(__dirname, "../resources/compiler", platform, `nwn_script_comp${process.platform === "win32" ? ".exe" : ""}`);
    const result = spawnSync(
      executable,
      ["-y", "-s", "-j", "1", ...(requireEntryPoint ? [] : ["--no-require-entry-point"]), "--userdirectory", workspace, "--root", workspace, "--dirs", workspace, "-c", join(workspace, file)],
      { encoding: "utf8", timeout: 20000 },
    );
    expect(result.error, file).to.equal(undefined);
    expect(result.signal, file).to.equal(null);
    return result;
  };

  for (const file of files) {
    it(`indexes without throwing: ${file}`, () => {
      expect(() => parserService.analyzeContent(readFileSync(join(fixtures, "corpus", file), "utf8"), "document")).not.to.throw();
    });
    it(`preserves upstream compiler acceptance/rejection: ${file}`, () => {
      const source = readFileSync(join(fixtures, "corpus", file), "utf8");
      const result = compile(file, !file.startsWith("inc_"));
      if (source.startsWith("// EXPECT: 623")) expect(result.stderr).to.include("1 skipped");
      expect(result.status, result.stderr).to.equal(source.startsWith("// EXPECT: ") && !source.startsWith("// EXPECT: 623") ? 1 : 0);
    });
  }

  for (const [file, status] of [
    ["nomain_valid.nss", 0],
    ["nomain_badsem.nss", 1],
    ["nomain_mismatch.nss", 1],
  ] as const) {
    it(`validates without an entry point: ${file}`, () => {
      const result = compile(file, false);
      expect(result.status, result.stderr).to.equal(status);
    });
  }

  for (const [file, reference, declaration, identifier, type] of [
    ["variables.nss", "Assert(a == 10)", "int a = 10", "a", "int"],
    ["variables.nss", "Assert(a == 1)", "int a = 1", "a", "int"],
    ["variables.nss", 'Assert(s == "B")', 'string s = "B"', "s", "string"],
    ["variables.nss", 'Assert(s == "A")', 'string s = "A"', "s", "string"],
    ["structs.nss", "d.a == a", "int a;", "a", "int"],
    ["structs.nss", "a.a = 1", "int a;", "a", "int"],
    ["functions.nss", "IntToString(arg)", "int arg", "arg", "int"],
    ["functions.nss", "if (arg == 0)", "int multiple_return_paths(int arg)", "arg", "int"],
    ["constants.nss", "Assert(B == 20)", "const int B = A + A", "B", "int"],
  ]) {
    it(`resolves the original declaration in ${file}: ${reference}`, () => {
      const source = readFileSync(join(fixtures, "corpus", file), "utf8");
      const live = TextDocument.create(workspaceUri(file), "nwscript", 1, source);
      const collection = new api.Collection();
      collection.createDocument(live.uri, parserService.analyzeContent(source, "document"));
      const handlers: any = {};
      const server = {
        documentsCollection: collection,
        parserService,
        config: api.config,
        liveDocumentsManager: { get: () => live },
        standardLibrary: { get: () => parserService.analyzeContent(readFileSync(join(fixtures, "nwtestvmscript.nss"), "utf8"), "document") },
        capabilitiesHandler: { getSupportsMarkdownHover: () => true },
        logger: {
          error: (message: string) => {
            throw new Error(message);
          },
        },
        connection: { onHover: (fn: any) => (handlers.hover = fn), onDefinition: (fn: any) => (handlers.definition = fn) },
      };
      api.Hover.register(server);
      api.Definition.register(server);
      // The member cases deliberately target the identifier after the dot.
      const referenceOffset = reference.includes(".") ? reference.indexOf(".") + 1 : reference.indexOf(identifier, reference.indexOf("(") + 1);
      const target = { textDocument: { uri: live.uri }, position: live.positionAt(source.indexOf(reference) + referenceOffset + 1) };
      const expected = live.positionAt(source.indexOf(declaration) + declaration.lastIndexOf(identifier));
      expect(handlers.definition(target)?.range.start).to.deep.equal(expected);
      expect(JSON.stringify(handlers.hover(target))).to.include(`${type} ${identifier}`);
    });
  }
});
