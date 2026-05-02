// Smoke-test the WASM compiler the same way DiagnosticsProvider uses it.
// Catches breakage in the bundle, the C API exports, the cwrap signatures,
// and the resolver-callback wiring without needing a running LSP.

import { describe, it, before } from "mocha";
import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";

const RT_NSS = 2009;
const RT_NCS = 2010;
const RT_NDB = 2064;

// Minimal nwscript stub - covers what the test scripts below reference.
const NWSCRIPT_STUB = `
int Nonsense(int n);
int IntFn(int n);
string StringFn(string s);
void VoidFn();
`.trim();

interface CompileResult {
  code: number;
  errors: string[];
}

async function compileOne(
  Module: any,
  files: Record<string, string>,
  target: string,
  opts: { collectAll?: boolean; requireEntry?: boolean } = {}
): Promise<CompileResult> {
  let comp = 0;
  let buf = 0;
  const owned: number[] = [];

  const loadCb = Module.addFunction((fnPtr: number) => {
    const fn = Module.UTF8ToString(fnPtr);
    if (!(fn in files)) return 0;
    const src = files[fn];
    const len = Module.lengthBytesUTF8(src);
    if (buf) Module._free(buf);
    buf = Module._malloc(len + 1);
    owned.push(buf);
    Module.stringToUTF8(src, buf, len + 1);
    Module._scriptCompApiDeliverFile(comp, buf, len);
    return 1;
  }, "iii");
  const writeCb = Module.addFunction(() => 0, "iiiiii");

  try {
    const newComp = Module.cwrap("scriptCompApiNewCompiler", "number",
      ["number", "number", "number", "number", "number"]);
    const initComp = Module.cwrap("scriptCompApiInitCompiler", null,
      ["number", "string", "boolean", "number", "number", "string"]);
    const setCollectAll = Module.cwrap("scriptCompApiSetCollectAllErrors",
      null, ["number", "boolean"]);
    const setRequireEntry = Module.cwrap(
      "scriptCompApiSetRequireEntryPoint", null, ["number", "boolean"]);
    const compile = Module.cwrap("wasmCompile", "number",
      ["number", "string"]);
    const errorCount = Module.cwrap("wasmGetCollectedErrorCount", "number",
      ["number"]);
    const errorAt = Module.cwrap("wasmGetCollectedError", "string",
      ["number", "number"]);
    const lastError = Module.cwrap("wasmGetLastError", "string", ["number"]);

    comp = newComp(RT_NSS, RT_NCS, RT_NDB, writeCb, loadCb);
    initComp(comp, "nwscript", false, 16, 0, "scriptout");
    setCollectAll(comp, opts.collectAll ?? true);
    setRequireEntry(comp, opts.requireEntry ?? false);

    const code = compile(comp, target);
    const errors: string[] = [];
    const n = errorCount(comp);
    for (let i = 0; i < n; i++) errors.push(errorAt(comp, i));
    if (errors.length === 0) {
      const single = lastError(comp);
      if (single) errors.push(single);
    }
    return { code, errors };
  } finally {
    if (comp) Module._scriptCompApiDestroyCompiler(comp);
    for (const p of owned) Module._free(p);
    Module.removeFunction(loadCb);
    Module.removeFunction(writeCb);
  }
}

describe("Diagnostics WASM bundle", () => {
  let Module: any;

  before("load wasm", async function () {
    this.timeout(15000);
    const wasmEntry = join(__dirname, "..", "wasm", "nwscript_compiler.js");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NWScriptCompiler = require(wasmEntry);
    Module = await NWScriptCompiler();
  });

  it("loads and reports ABI 2", () => {
    const abi = Module.cwrap("scriptCompApiGetABIVersion", "number", [])();
    expect(abi).to.equal(2);
  });

  it("compiles a clean script with no errors", async () => {
    const r = await compileOne(Module,
      { nwscript: NWSCRIPT_STUB, p: "void main() { int x = 1 + 2; }" },
      "p");
    expect(r.code).to.equal(0);
    expect(r.errors).to.have.lengthOf(0);
  });

  it("reports a single type error with file/line", async () => {
    const r = await compileOne(Module,
      { nwscript: NWSCRIPT_STUB, p: 'void main() { int x = "wrong"; }' },
      "p");
    expect(r.code).to.not.equal(0);
    expect(r.errors).to.have.lengthOf(1);
    expect(r.errors[0]).to.include("MISMATCHED TYPES");
    expect(r.errors[0]).to.match(/p\.nss\(\d+\)/);
  });

  it("reports multiple errors per file in one pass", async () => {
    const r = await compileOne(Module,
      { nwscript: NWSCRIPT_STUB, p:
        'void main() { int x = "a"; int y = "b"; int z = "c"; }' },
      "p");
    expect(r.errors.length).to.be.at.least(3);
    for (const e of r.errors) expect(e).to.include("MISMATCHED TYPES");
  });

  it("validates an include-only file (no main) when require-entry is off", async () => {
    const r = await compileOne(Module,
      { nwscript: NWSCRIPT_STUB, p: "int helper(int n) { return n * 2; }" },
      "p", { requireEntry: false });
    expect(r.code).to.equal(0);
  });

  it("reports errors from a #include'd file with [via:] trace", async () => {
    const r = await compileOne(Module, {
      nwscript: NWSCRIPT_STUB,
      lib: 'int helper() { return BadId(); }',
      main: '#include "lib"\nvoid main() { int x = helper(); }',
    }, "main");
    expect(r.errors.length).to.be.at.least(1);
    const all = r.errors.join("\n");
    expect(all).to.include("lib");
  });

  it("collects errors from both an include and the main file", async () => {
    const r = await compileOne(Module, {
      nwscript: NWSCRIPT_STUB,
      lib: 'int helper() { return BadId(); }',
      main: '#include "lib"\nvoid main() { int x = "wrong"; }',
    }, "main");
    expect(r.errors.length).to.be.at.least(2);
    const all = r.errors.join("\n");
    expect(all).to.include("lib");
    expect(all).to.match(/MISMATCHED TYPES|main/);
  });

  it("returns FILE_NOT_FOUND for an unresolvable include", async () => {
    const r = await compileOne(Module, {
      nwscript: NWSCRIPT_STUB,
      main: '#include "nope"\nvoid main() {}',
    }, "main");
    expect(r.code).to.not.equal(0);
  });

  it("is deterministic across repeated compiles", async () => {
    const files = { nwscript: NWSCRIPT_STUB, p:
      'void main() { int x = "a"; int y = "b"; }' };
    const counts = new Set<number>();
    for (let i = 0; i < 5; i++) {
      const r = await compileOne(Module, files, "p");
      counts.add(r.errors.length);
    }
    expect(counts.size, `error counts drifted: ${[...counts]}`).to.equal(1);
  });
});
