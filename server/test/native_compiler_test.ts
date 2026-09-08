import { before, beforeEach, afterEach, describe, it } from "mocha";
import { expect } from "chai";
import { buildSync } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { pathToFileURL } from "url";
import type { Diagnostic } from "vscode-languageserver";
import type DiagnosticsProvider from "../src/Providers/DiagnosticsProvider";
import type { ServerManager } from "../src/ServerManager";

// Exercise the actual bundled provider and shipped executable. A minimal game
// directory supplies the language specification without requiring an NWN install.
describe("Native compiler diagnostics", function () {
  this.timeout(30000);
  let Provider: typeof DiagnosticsProvider;
  let workspace: string;
  let provider: DiagnosticsProvider;
  let published: Map<string, Diagnostic[]>;
  let documents: Map<string, any>;
  let config: any;
  let errors: string[];

  before(() => {
    const bundle = join(__dirname, "..", "out", "diagnostics-provider-test.js");
    buildSync({
      entryPoints: [join(__dirname, "..", "src", "Providers", "DiagnosticsProvider.ts")],
      outfile: bundle,
      bundle: true,
      platform: "node",
    });
    Provider = require(bundle).default;
  });

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "nwscript migration & spaces "));
    mkdirSync(join(workspace, "lang", "en"), { recursive: true });
    mkdirSync(join(workspace, "ovr"));
    writeFileSync(join(workspace, "databuild.txt"), "test\n");
    writeFileSync(join(workspace, "ovr", "nwscript.nss"), "int IntFn(int n);\n");
    errors = [];
    published = new Map();
    documents = new Map();
    config = {
      compiler: {
        enabled: true,
        verbose: false,
        reportWarnings: true,
        os: null,
        nwnHome: workspace,
        nwnInstallation: workspace,
      },
    };
    const server = {
      config,
      configLoaded: true,
      documentsWaitingForPublish: [],
      documentsCollection: {
        getFromUri: (uri: string) => [...documents.values()].find((doc) => doc.uri === uri),
        get: (name: string) => documents.get(name),
      },
      workspaceFilesSystem: {
        getWorkspaceRootPath: () => workspace,
        getFilePath: (name: string) => (name === "nwscript" ? join(workspace, "ovr", "nwscript.nss") : null),
      },
      logger: { info: () => {}, error: (message: string) => errors.push(message) },
      connection: {
        sendDiagnostics: ({ uri, diagnostics }: { uri: string; diagnostics: Diagnostic[] }) => published.set(uri, diagnostics),
      },
    };
    provider = new Provider(server as unknown as ServerManager);
  });

  afterEach(() => rmSync(workspace, { recursive: true, force: true }));

  async function publish(uri: string) {
    expect(await provider.publish(uri), errors.join("\n")).to.equal(true);
  }

  function script(relativePath: string, source: string, children: string[] = []) {
    const path = join(workspace, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
    const uri = pathToFileURL(path).href;
    documents.set(basename(path, ".nss"), { uri, getChildren: () => children });
    return { path, uri };
  }

  it("validates a standalone include without writing compiler artifacts", async () => {
    const helper = script("lib/helper.nss", "int helper(int n) { return n * 2; }");
    await publish(helper.uri);
    expect(published.get(helper.uri)).to.deep.equal([]);
    expect(existsSync(helper.path.replace(/\.nss$/, ".ncs"))).to.equal(false);
    expect(existsSync(helper.path.replace(/\.nss$/, ".ndb"))).to.equal(false);
  });

  it("checks semantic errors inside helpers and clears diagnostics after fixing them", async () => {
    const helper = script("helper.nss", 'void foo(int a) {}\nvoid bar() { foo("bad"); }');
    await publish(helper.uri);
    const diagnostics = published.get(helper.uri)!;
    expect(diagnostics).to.have.lengthOf(1);
    expect(diagnostics[0].message).to.include("DECLARATION DOES NOT MATCH PARAMETERS");
    expect(diagnostics[0].range.start.line).to.equal(1);
    writeFileSync(helper.path, "void foo(int a) {}\nvoid bar() { foo(1); }");
    await publish(helper.uri);
    expect(published.get(helper.uri)).to.deep.equal([]);
  });

  it("resolves transitive includes in separate directories and reports the owning file", async () => {
    const leaf = script("constants/leaf.nss", 'int leaf() { return "wrong"; }');
    script("libraries/helper.nss", '#include "leaf"\nint helper() { return leaf(); }', ["leaf"]);
    const main = script("scripts/main.nss", '#include "helper"\nvoid main() { int x = helper(); }', ["helper", "leaf"]);
    await publish(main.uri);
    expect(published.get(leaf.uri)).to.have.lengthOf(1);
    expect(published.get(leaf.uri)![0].message).to.include("RETURN TYPE AND FUNCTION TYPE");
    expect(published.get(main.uri)).to.deep.equal([]);
    writeFileSync(leaf.path, "int leaf() { return 1; }");
    await publish(main.uri);
    expect(published.get(leaf.uri)).to.deep.equal([]);
    expect(published.get(main.uri)).to.deep.equal([]);
    expect(existsSync(main.path.replace(/\.nss$/, ".ncs"))).to.equal(false);
  });

  it("diagnoses a missing include against the target file", async () => {
    const main = script("main.nss", '#include "missing"\nvoid main() {}');
    await publish(main.uri);
    expect(published.get(main.uri)).to.have.lengthOf(1);
    expect(published.get(main.uri)![0].message).to.include("FILE NOT FOUND");
  });

  it("validates a conditional script whose include defines main", async () => {
    script("lib.nss", "void main() {}\nint helper() { return 1; }");
    const conditional = script("condition.nss", '#include "lib"\nint StartingConditional() { return helper(); }', ["lib"]);
    await publish(conditional.uri);
    expect(published.get(conditional.uri)).to.deep.equal([]);
  });

  it("keeps diagnostics visible for game includes without workspace documents", async () => {
    writeFileSync(join(workspace, "ovr", "stock_lib.nss"), 'int helper() { return "wrong"; }');
    const main = script("main.nss", '#include "stock_lib"\nvoid main() { int x = helper(); }');
    await publish(main.uri);
    expect(published.get(main.uri)).to.have.lengthOf(1);
    expect(published.get(main.uri)![0].message).to.include("stock_lib.nss");
  });

  it("clears an existing error when the saved document becomes empty", async () => {
    const main = script("main.nss", 'void main() { int x = "wrong"; }');
    await publish(main.uri);
    expect(published.get(main.uri)).to.have.lengthOf(1);
    writeFileSync(main.path, "");
    await publish(main.uri);
    expect(published.get(main.uri)).to.deep.equal([]);
    expect(errors).to.deep.equal([]);
    writeFileSync(main.path, "void main() {}");
    await publish(main.uri);
    expect(published.get(main.uri)).to.deep.equal([]);
  });

  it("uses the indexed include even when other search directories and the target contain duplicates", async () => {
    const chosen = script("selected/choice.nss", "int chosen() { return 1; }");
    script("other/extra.nss", "void extra() {}");
    const main = script("scripts/main.nss", '#include "choice"\n#include "extra"\nvoid main() { int x = chosen(); }', ["choice", "extra"]);
    for (const directory of ["scripts", "other", "ovr"]) {
      writeFileSync(join(workspace, directory, "choice.nss"), 'int chosen() { return "wrong"; }');
    }
    await publish(main.uri);
    expect(published.get(main.uri)).to.deep.equal([]);
    expect(published.get(chosen.uri)).to.deep.equal([]);
    // Changing the selected file must affect compilation and diagnostic routing.
    writeFileSync(chosen.path, 'int chosen() { return "wrong"; }');
    await publish(main.uri);
    expect(published.get(chosen.uri)).to.have.lengthOf(1);
  });

  it("validates an include chain deeper than the compiler default", async () => {
    const children = Array.from({ length: 25 }, (_, i) => `chain${i}`);
    children.forEach((name, i) => script(`lib/${name}.nss`, i < 24 ? `#include "chain${i + 1}"\n` : "// end\n"));
    const main = script("main.nss", '#include "chain0"\nvoid main() {}', children);
    await publish(main.uri);
    expect([...published.values()].every((diagnostics) => diagnostics.length === 0)).to.equal(true);
  });

  it("preserves existing compiler artifacts beside the source", async () => {
    const main = script("main.nss", "void main() {}");
    const ndb = main.path.replace(/\.nss$/, ".ndb");
    const ncs = main.path.replace(/\.nss$/, ".ncs");
    writeFileSync(ndb, "existing debug symbols");
    writeFileSync(ncs, "existing compiled script");
    await publish(main.uri);
    expect(readFileSync(ndb, "utf8")).to.equal("existing debug symbols");
    expect(readFileSync(ncs, "utf8")).to.equal("existing compiled script");
  });

  it("reports an unreadable source without publishing a clean result", async () => {
    const main = script("main.nss", "void main() {}");
    rmSync(main.path);
    expect(await provider.publish(main.uri)).to.equal(false);
    expect(published.size).to.equal(0);
    expect(errors.join("\n")).to.include("Unable to validate").and.include(main.uri);
  });

  it("does not clear diagnostics when the compiler cannot load the game directory", async () => {
    const helper = script("helper.nss", "int helper() { return 1; }");
    config.compiler.nwnInstallation = join(workspace, "missing-game");
    expect(await provider.publish(helper.uri)).to.equal(false);
    expect(published.size).to.equal(0);
    expect(errors.join("\n")).to.include("nwnInstallation and nwnHome");
  });
});
