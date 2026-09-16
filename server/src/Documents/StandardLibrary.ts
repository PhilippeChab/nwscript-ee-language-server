import { normalizeDocumentUri } from "../Utils";
import { readFileSync } from "fs";
import { basename, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ParserService } from "../Parser";
import { DocumentIndex, AnalysisMode } from "../Parser/ParserService";
import type WorkspaceFilesSystem from "../WorkspaceFilesSystem/WorkspaceFilesSystem";

export const isStandardLibrary = (uri: string) => basename(fileURLToPath(uri)).toLowerCase() === "nwscript.nss";
export type StandardLibraryDefinitions = DocumentIndex & { owner?: string };

/** One selected source per workspace folder; never merge a custom API with the bundled API. */
export default class StandardLibrary {
  private readonly bundled: StandardLibraryDefinitions;
  private readonly live = new Map<string, TextDocument>();
  private readonly selections = new Map<string, string | null>();
  private readonly snapshots = new Map<string, { content: string; definitions: StandardLibraryDefinitions }>();
  private readonly failures = new Map<string, string>();
  private readonly disk = new Map<string, string>();
  private readonly attempted = new Map<string, string>();

  constructor(private readonly files: WorkspaceFilesSystem, private readonly parserService: ParserService, private readonly report: (message: string) => void) {
    this.bundled = JSON.parse(readFileSync(join(__dirname, "..", "resources", "standardLibDefinitions.json"), "utf8"));
  }

  public invalidate() {
    this.selections.clear();
    this.disk.clear();
  }

  public change(document: TextDocument) {
    if (!isStandardLibrary(document.uri)) return;
    this.live.set(normalizeDocumentUri(document.uri), document);
    this.invalidate();
  }

  public close(uri: string) {
    const key = normalizeDocumentUri(uri);
    this.live.delete(key);
    // Discard unsaved snapshots when reverting to disk, including failed reads.
    this.snapshots.delete(key);
    this.failures.delete(key);
    this.attempted.delete(key);
    this.invalidate();
  }

  public getPath(uri: string) {
    const root = this.files.getRootForUri(uri);
    if (!root) return null;
    if (!this.selections.has(root)) {
      try {
        this.selections.set(root, this.files.getStandardLibraryPath(uri));
      } catch (error) {
        this.report(`Cannot search ${root} for nwscript.nss: ${error instanceof Error ? error.message : String(error)}. Using bundled definitions.`);
        this.selections.set(root, null);
      }
    }
    return this.selections.get(root) ?? null;
  }

  public get(uri: string): StandardLibraryDefinitions {
    const path = this.getPath(uri);
    if (!path) return this.bundled;
    const owner = pathToFileURL(path).href;
    const previous = this.snapshots.get(owner);
    try {
      const liveDocument = this.live.get(owner);
      if (!liveDocument && !this.disk.has(owner)) this.disk.set(owner, readFileSync(fileURLToPath(owner), "utf8"));
      const content = liveDocument?.getText() ?? this.disk.get(owner);
      if (content === undefined) throw new Error("No source content available");
      if (previous?.content === content) return previous.definitions;
      if (this.attempted.get(owner) === content) return previous?.definitions ?? this.bundled;
      this.attempted.set(owner, content);
      const scope = liveDocument ? this.parserService.getDocumentIndex(liveDocument) : this.parserService.analyzeContent(content, AnalysisMode.document);
      if (!scope.globalDeclarations.length && !scope.structDeclarations.length) throw new Error("No declarations could be parsed");
      const definitions = { ...scope, owner };
      this.snapshots.set(owner, { content, definitions });
      this.failures.delete(owner);
      return definitions;
    } catch (error) {
      const message = `Cannot load ${path}: ${error instanceof Error ? error.message : String(error)}. Using ${previous ? "the last usable workspace definitions" : "bundled definitions"}.`;
      if (this.failures.get(owner) !== message) this.report(message);
      this.failures.set(owner, message);
      return previous?.definitions ?? this.bundled;
    }
  }
}
