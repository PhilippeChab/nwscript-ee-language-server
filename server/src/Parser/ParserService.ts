import { join } from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import SyntaxDocument from "./SyntaxDocument";
import { AnalysisMode, DocumentIndex, LocalScope } from "./contracts";
export * from "./contracts";

export default class ParserService {
  private readonly documents = new WeakMap<TextDocument, { version: number; syntax: SyntaxDocument }>();
  constructor(private readonly localPath = false) {}

  public async loadGrammar() {
    await SyntaxDocument.loadGrammar(join(__dirname, this.localPath ? "../.." : "..", "resources"));
    return this;
  }

  public parse(document: TextDocument): SyntaxDocument {
    const cached = this.documents.get(document);
    if (cached?.version === document.version) return cached.syntax;
    const syntax = this.parseContent(document, cached?.syntax);
    this.documents.set(document, { version: document.version, syntax });
    return syntax;
  }

  public parseContent(content: string | TextDocument, previous?: SyntaxDocument): SyntaxDocument {
    const document =
      typeof content === "string" ? TextDocument.create("file:///syntax.nss", "nwscript", 0, content) : TextDocument.create(content.uri, content.languageId, content.version, content.getText());
    if (!previous) return SyntaxDocument.create(document);
    previous.update(document);
    return previous;
  }

  public getDocumentIndex(document: TextDocument): DocumentIndex {
    return this.parse(document).getIndex(true);
  }

  public analyzeContent(content: string | TextDocument, mode: AnalysisMode.document, startIndex?: number, stopIndex?: number): DocumentIndex;
  public analyzeContent(content: string | TextDocument, mode: AnalysisMode.local, startIndex?: number, stopIndex?: number): LocalScope;
  public analyzeContent(content: string | TextDocument, mode: AnalysisMode, startIndex = 0, stopIndex = -1) {
    const syntax = this.parseContent(content);
    try {
      return mode === AnalysisMode.document ? syntax.getIndex(true) : syntax.getLocalScope(stopIndex < 0 ? undefined : { line: stopIndex, character: Number.MAX_SAFE_INTEGER }, startIndex);
    } finally {
      syntax.dispose();
    }
  }
}
