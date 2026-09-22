import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "fs";
import { get } from "https";
import { join } from "path";
import AdmZip from "adm-zip";
import { ParserService } from "../src/Parser";
import { AnalysisMode } from "../src/Parser/ParserService";

const downloadsUrl = "https://nwn.beamdog.net/downloads/";
const releaseNotesUrl = "https://nwn.beamdog.net/docs/CHANGELOG.md";
export type SourceMetadata = {
  version: string;
  releaseNotesUrl: string;
  archiveUrl: string;
  archiveSha256: string;
  keyPath: string;
  resourceName: string;
  sourceSha256: string;
};
export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export function compareVersions(a: string, b: string) {
  const left = a.split(/[.-]/).map(Number);
  const right = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function latestRelease(changelog: string, index: string) {
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+(?:\.\d+)*(?:-\d+)?)\] - \d{4}-\d{2}-\d{2}\s*$/gm)].map((match) => match[1]);
  const version = versions.sort(compareVersions).at(-1);
  if (!version) throw new Error("No released versions found in Beamdog's changelog");
  const filename = `nwnee-dedicated-${version.slice(version.indexOf(".") + 1)}.zip`;
  const links = [...index.matchAll(/href=["']([^"']+)["']/g)].map((match) => match[1]);
  if (!links.includes(filename)) throw new Error(`Latest release ${version} has no published archive (${filename})`);
  return { version, archiveUrl: new URL(filename, downloadsUrl).href };
}

export function publishedChecksum(text: string, archiveUrl: string) {
  const filename = new URL(archiveUrl).pathname.split("/").at(-1);
  if (!filename) throw new Error(`Archive URL has no filename: ${archiveUrl}`);
  const entry = text.trim().match(/^([a-fA-F0-9]{64})\s+\*?(\S+)$/);
  if (!entry || entry[2] !== filename) throw new Error(`Invalid published checksum for ${filename}`);
  return entry[1].toLowerCase();
}

async function download(url: string): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${String(response.statusCode)} downloading ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
      response.on("aborted", () => reject(new Error(`Download interrupted: ${url}`)));
    });
    request.setTimeout(60000, () => request.destroy(new Error(`Download timed out: ${url}`)));
    request.on("error", reject);
  });
}

export function extractSources(data: Buffer, metadata: SourceMetadata, resourceNames: string[]) {
  if (sha256(data) !== metadata.archiveSha256) throw new Error("Archive SHA-256 mismatch");
  const archive = new AdmZip(data);
  const contents = new Map<string, Buffer>();
  const read = (name: string) => {
    const cached = contents.get(name);
    if (cached) return cached;
    const entries = archive.getEntries().filter((entry) => entry.entryName === name);
    if (entries.length !== 1) throw new Error(`Expected exactly one archive entry: ${name}`);
    const content = entries[0].getData();
    contents.set(name, content);
    return content;
  };
  const key = read(metadata.keyPath);
  if (key.subarray(0, 8).toString() !== "KEY V1  ") throw new Error("Unsupported KEY format");
  const bifCount = key.readUInt32LE(8);
  const count = key.readUInt32LE(12);
  const bifOffset = key.readUInt32LE(16);
  const resourceOffset = key.readUInt32LE(20);
  const matches = new Map(resourceNames.map((name) => [name, [] as number[]]));
  for (let i = 0; i < count; i++) {
    const offset = resourceOffset + i * 22;
    const name = key
      .subarray(offset, offset + 16)
      .toString("ascii")
      .replace(/\0.*$/, "");
    if (key.readUInt16LE(offset + 16) === 2009) matches.get(name)?.push(key.readUInt32LE(offset + 18));
  }
  const sources = new Map<string, Buffer>();
  for (const [name, ids] of matches) {
    if (ids.length !== 1) throw new Error(`Expected one ${name}.nss resource, found ${ids.length}`);
    // KEY resource IDs encode the BIF index above the 20-bit resource index.
    const resourceId = ids[0];
    const bifIndex = resourceId >>> 20;
    if (bifIndex >= bifCount) throw new Error("Invalid BIF index");
    const entryOffset = bifOffset + bifIndex * 12;
    const nameOffset = key.readUInt32LE(entryOffset + 4);
    const nameLength = key.readUInt16LE(entryOffset + 8);
    const bifPath = key
      .subarray(nameOffset, nameOffset + nameLength)
      .toString("ascii")
      .replace(/\0.*$/, "")
      .replace(/\\/g, "/");
    const bif = read(bifPath);
    if (bif.subarray(0, 8).toString() !== "BIFFV1  ") throw new Error("Unsupported BIF format");
    const index = resourceId & 0xfffff;
    if (index >= bif.readUInt32LE(8)) throw new Error("Invalid BIF resource index");
    const offset = bif.readUInt32LE(16) + index * 16;
    const start = bif.readUInt32LE(offset + 4);
    const size = bif.readUInt32LE(offset + 8);
    if ((bif.readUInt32LE(offset) & 0xfffff) !== index || bif.readUInt32LE(offset + 12) !== 2009 || start + size > bif.length) throw new Error("Invalid NSS resource entry");
    sources.set(name, bif.subarray(start, start + size));
  }
  return sources;
}

export function extractSource(data: Buffer, metadata: SourceMetadata) {
  const source = extractSources(data, metadata, [metadata.resourceName]).get(metadata.resourceName);
  if (!source) throw new Error(`Missing script resource: ${metadata.resourceName}`);
  return source;
}

// Network/extraction/parsing all finish before any repository file is changed.
export async function updateStandardLibrary(options: { scripts?: string; pinned?: boolean; archive?: string; download?: (url: string) => Promise<Buffer> } = {}) {
  const scripts = options.scripts || __dirname;
  const fetch = options.download || download;
  const metadataPath = join(scripts, "../resources/standardLibSource.json");
  const current: SourceMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  let metadata = { ...current };
  const pinned = options.pinned || Boolean(options.archive);
  if (!pinned) {
    const [notes, index] = await Promise.all([fetch(releaseNotesUrl), fetch(downloadsUrl)]);
    const latest = latestRelease(notes.toString("utf8"), index.toString("utf8"));
    if (compareVersions(latest.version, current.version) < 0) throw new Error(`Published release ${latest.version} is older than the recorded ${current.version}; refusing to downgrade`);
    const checksum = publishedChecksum((await fetch(`${latest.archiveUrl}.sha256sum`)).toString("utf8"), latest.archiveUrl);
    if (latest.version === current.version && checksum !== current.archiveSha256) throw new Error("Published archive checksum changed for the recorded version");
    metadata = { ...metadata, ...latest, releaseNotesUrl, archiveSha256: checksum };
  }
  const sourcePath = join(scripts, "nwscript.nss");
  let source = existsSync(sourcePath) ? readFileSync(sourcePath) : undefined;
  if (options.archive || metadata.version !== current.version || !source || sha256(source) !== current.sourceSha256) {
    const archive = options.archive ? readFileSync(options.archive) : await fetch(metadata.archiveUrl);
    source = extractSource(archive, metadata);
  }
  if (!source) throw new Error("Missing nwscript.nss");
  if (metadata.version === current.version && sha256(source) !== current.sourceSha256) throw new Error("nwscript.nss SHA-256 mismatch for the recorded version");
  metadata.sourceSha256 = sha256(source);
  const parserService = await new ParserService(true).loadGrammar();
  const definitions = parserService.analyzeContent(TextDocument.create(pathToFileURL(sourcePath).href, "nwscript", 0, source.toString("utf8")), AnalysisMode.document);
  if (!definitions.globalDeclarations.length) throw new Error("No standard library declarations could be parsed");
  const updates: [string, Buffer][] = [
    [sourcePath, source],
    [join(scripts, "../resources/standardLibDefinitions.json"), Buffer.from(JSON.stringify(definitions, null, 4))],
    [metadataPath, Buffer.from(JSON.stringify(metadata, null, 2) + "\n")],
  ];
  for (const [path, content] of updates) {
    if (existsSync(path) && readFileSync(path).equals(content)) continue;
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, content);
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return { version: metadata.version, updated: metadata.version !== current.version };
}

if (require.main === module) {
  const run = async () => {
    const args = process.argv.slice(2);
    let pinned = false;
    let archive: string | undefined;
    while (args.length) {
      const arg = args.shift();
      if (arg === "--pinned") pinned = true;
      else if (arg === "--archive" && args[0] && !args[0].startsWith("--")) archive = args.shift();
      else throw new Error("Usage: update-standard-lib [--pinned] [--archive path.zip]");
    }
    console.log(pinned || archive ? "Reproducing recorded standard library..." : "Checking Beamdog for the latest release...");
    const result = await updateStandardLibrary({ pinned, archive });
    console.log(`${result.updated ? "Updated to" : "Verified"} ${result.version}${pinned || archive ? " (recorded version)" : " (latest release)"}.`);
  };
  run().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
