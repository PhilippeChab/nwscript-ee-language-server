import { join } from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import SyntaxDocument from "./SyntaxDocument";
import { TokenizationMode, DocumentTokenizationResult, LocalScopeTokenizationResult } from "./contracts";
export * from "./contracts";

export default class Tokenizer {
  private readonly documents = new WeakMap<TextDocument, { version: number; syntax: SyntaxDocument }>();
  constructor(private readonly localPath = false) {}

  public async loadGrammar() {
    await SyntaxDocument.loadGrammar(join(__dirname, this.localPath ? "../.." : "..", "resources"));
    return this;
  }

  public parse(document: TextDocument): SyntaxDocument {
    const cached = this.documents.get(document);
    if (cached?.version === document.version) return cached.syntax;
    const syntax = this.parseContent(document.getText(), cached?.syntax);
    this.documents.set(document, { version: document.version, syntax });
    return syntax;
  }

  public parseContent(content: string, previous?: SyntaxDocument): SyntaxDocument {
    const document = TextDocument.create("file:///syntax.nss", "nwscript", 0, content);
    if (!previous) return SyntaxDocument.create(document);
    previous.update(document);
    return previous;
  }

  public tokenizeDocument(document: TextDocument): DocumentTokenizationResult {
    return this.parse(document).getIndex(true);
  }

  public tokenizeContent(content: string, mode: TokenizationMode.document, startIndex?: number, stopIndex?: number): DocumentTokenizationResult;
  public tokenizeContent(content: string, mode: TokenizationMode.local, startIndex?: number, stopIndex?: number): LocalScopeTokenizationResult;
  public tokenizeContent(content: string, mode: TokenizationMode, startIndex = 0, stopIndex = -1) {
    const syntax = this.parseContent(content);
    try {
      return mode === TokenizationMode.document ? syntax.getIndex(true) : syntax.getLocalScope(stopIndex < 0 ? undefined : { line: stopIndex, character: Number.MAX_SAFE_INTEGER }, startIndex);
    } finally {
      syntax.dispose();
    }
  }
}
