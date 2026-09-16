import { afterEach, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import AdmZip from "adm-zip";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { extractSources, latestRelease, publishedChecksum, sha256, updateStandardLibrary } from "../scripts/UpdateStandardLibrary";

function archiveFor(source: Buffer, additional: Record<string, Buffer> = {}) {
  const entries = Object.entries({ nwscript: source, ...additional });
  const key = Buffer.alloc(96 + entries.length * 22);
  key.write("KEY V1  ");
  key.writeUInt32LE(1, 8);
  key.writeUInt32LE(entries.length, 12);
  key.writeUInt32LE(64, 16);
  key.writeUInt32LE(96, 20);
  key.writeUInt32LE(76, 68);
  key.writeUInt16LE(14, 72);
  key.write("data/test.bif\0", 76);
  let start = 20 + entries.length * 16;
  const bif = Buffer.alloc(start + entries.reduce((size, [, content]) => size + content.length, 0));
  bif.write("BIFFV1  ");
  bif.writeUInt32LE(entries.length, 8);
  bif.writeUInt32LE(20, 16);
  entries.forEach(([name, content], index) => {
    const resourceOffset = 96 + index * 22;
    key.write(name, resourceOffset);
    key.writeUInt16LE(2009, resourceOffset + 16);
    key.writeUInt32LE(index, resourceOffset + 18);
    const offset = 20 + index * 16;
    bif.writeUInt32LE(index, offset);
    bif.writeUInt32LE(start, offset + 4);
    bif.writeUInt32LE(content.length, offset + 8);
    bif.writeUInt32LE(2009, offset + 12);
    content.copy(bif, start);
    start += content.length;
  });
  const zip = new AdmZip();
  zip.addFile("data/nwn_base.key", key);
  zip.addFile("data/test.bif", bif);
  return zip.toBuffer();
}

describe("Standard library updater", () => {
  let root: string;
  let scripts: string;
  let metadata: any;
  let responses: Map<string, Buffer>;
  let requests: string[];
  const base = "https://nwn.beamdog.net/downloads/";
  const notes = "https://nwn.beamdog.net/docs/CHANGELOG.md";
  const latestUrl = base + "nwnee-dedicated-8193.37-17.zip";
  const source = Buffer.from("// Latest API\nfloat NewFn(int value = 7);\n");
  const latestArchive = archiveFor(source);
  const download = async (url: string) => {
    requests.push(url);
    const response = responses.get(url);
    if (!response) throw new Error(`HTTP failure: ${url}`);
    return response;
  };
  const snapshot = () => ["scripts/nwscript.nss", "resources/standardLibSource.json", "resources/standardLibDefinitions.json"].map((path) => readFileSync(join(root, path)).toString());

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nwscript-update-"));
    scripts = join(root, "scripts");
    mkdirSync(scripts);
    mkdirSync(join(root, "resources"));
    const old = Buffer.from("int OldFn();\n");
    metadata = {
      version: "89.8193.37-9",
      releaseNotesUrl: notes,
      archiveUrl: base + "nwnee-dedicated-8193.37-9.zip",
      archiveSha256: sha256(archiveFor(old)),
      keyPath: "data/nwn_base.key",
      resourceName: "nwscript",
      sourceSha256: sha256(old),
    };
    writeFileSync(join(root, "resources/standardLibSource.json"), JSON.stringify(metadata));
    writeFileSync(join(root, "resources/standardLibDefinitions.json"), "old bundle");
    writeFileSync(join(scripts, "nwscript.nss"), old);
    requests = [];
    responses = new Map([
      [notes, Buffer.from("## [Unreleased]\n## [89.8193.37-9] - 2024-01-01\n## [89.8193.37-17] - 2025-10-06\n")],
      [base, Buffer.from("<a href='nwnee-dedicated-8193.37-17.zip'>download</a>")],
      [latestUrl + ".sha256sum", Buffer.from(`${sha256(latestArchive)}  nwnee-dedicated-8193.37-17.zip\n`)],
      [latestUrl, latestArchive],
    ]);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("extracts multiple bundled scripts and rejects missing resources", () => {
    const helper = Buffer.from("const int VALUE = 1;\nvoid Imported() {}\n");
    const archive = archiveFor(source, { helper });
    const pinned = { ...metadata, archiveSha256: sha256(archive) };
    const extracted = extractSources(archive, pinned, ["helper", "nwscript"]);
    expect(extracted.get("helper")?.equals(helper)).to.equal(true);
    expect(extracted.get("nwscript")?.equals(source)).to.equal(true);
    expect(() => extractSources(archive, pinned, ["helper", "missing"])).to.throw("Expected one missing.nss resource");
  });

  it("discovers a newer release numerically and updates source, metadata, and definitions together", async () => {
    expect(await updateStandardLibrary({ scripts, download })).to.deep.equal({ updated: true, version: "89.8193.37-17" });
    const saved = JSON.parse(readFileSync(join(root, "resources/standardLibSource.json"), "utf8"));
    expect(saved.sourceSha256).to.equal(sha256(source));
    expect(saved.archiveSha256).to.equal(sha256(latestArchive));
    expect(readFileSync(join(scripts, "nwscript.nss")).equals(source)).to.equal(true);
    const definitions = JSON.parse(readFileSync(join(root, "resources/standardLibDefinitions.json"), "utf8"));
    expect(definitions.globalDeclarations.map((declaration: any) => declaration.identifier)).to.deep.equal(["NewFn"]);
    expect(definitions.globalDeclarations[0].params[0].defaultValue).to.equal("7");
  });

  it("checks upstream when already current without redownloading the archive or changing files", async () => {
    await updateStandardLibrary({ scripts, download });
    const before = snapshot();
    requests = [];
    expect((await updateStandardLibrary({ scripts, download })).updated).to.equal(false);
    expect(requests).to.include(notes).and.include(base);
    expect(requests).not.to.include(latestUrl);
    expect(snapshot()).to.deep.equal(before);
  });

  for (const failure of ["network", "checksum", "archive", "parse"] as const) {
    it(`preserves all existing files on ${failure} failure`, async () => {
      if (failure === "network") responses.delete(latestUrl);
      if (failure === "checksum") responses.set(latestUrl, Buffer.from("corrupt"));
      if (failure === "archive" || failure === "parse") {
        const data = failure === "archive" ? Buffer.from("not a zip") : archiveFor(Buffer.from("int Broken("));
        responses.set(latestUrl, data);
        responses.set(latestUrl + ".sha256sum", Buffer.from(`${sha256(data)}  nwnee-dedicated-8193.37-17.zip`));
      }
      const before = snapshot();
      let error: unknown;
      try {
        await updateStandardLibrary({ scripts, download });
      } catch (caught) {
        error = caught;
      }
      expect(error).to.be.instanceOf(Error);
      expect(snapshot()).to.deep.equal(before);
    });
  }

  it("reproduces a recorded archive offline", async () => {
    const archive = join(root, "cached.zip");
    writeFileSync(archive, archiveFor(readFileSync(join(scripts, "nwscript.nss"))));
    // ZIP timestamps are fixed within this fixture's run; record the exact cached bytes.
    metadata.archiveSha256 = sha256(readFileSync(archive));
    writeFileSync(join(root, "resources/standardLibSource.json"), JSON.stringify(metadata));
    await updateStandardLibrary({ scripts, archive, download });
    expect(requests).to.deep.equal([]);
  });

  it("rejects missing release archives and checksums for a different filename", () => {
    const index = responses.get(base);
    if (!index) throw new Error("Missing download-index fixture");
    expect(() => latestRelease("## [89.8193.38-1] - 2026-01-01\n", index.toString())).to.throw("no published archive");
    expect(() => publishedChecksum(`${"a".repeat(64)}  another.zip`, latestUrl)).to.throw("Invalid published checksum");
  });

  it("refuses to downgrade a newer recorded version", async () => {
    metadata.version = "89.8193.38-1";
    writeFileSync(join(root, "resources/standardLibSource.json"), JSON.stringify(metadata));
    const before = snapshot();
    let error: unknown;
    try {
      await updateStandardLibrary({ scripts, download });
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).to.include("refusing to downgrade");
    expect(snapshot()).to.deep.equal(before);
  });
});
