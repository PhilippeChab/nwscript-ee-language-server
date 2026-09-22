import { join } from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import Syntax from "./Syntax";
import type { SyntaxIndex } from "./SyntaxIndex";

export default class Parser {
  private readonly documents = new WeakMap<TextDocument, { version: number; syntax: Syntax }>();
  constructor(private readonly localPath = false) {}

  public async loadGrammar() {
    await Syntax.loadGrammar(join(__dirname, this.localPath ? "../.." : "..", "resources"));
    return this;
  }

  public parse(document: TextDocument): Syntax {
    const cached = this.documents.get(document);
    if (cached?.version === document.version) return cached.syntax;
    const syntax = this.parseContent(document, cached?.syntax);
    this.documents.set(document, { version: document.version, syntax });
    return syntax;
  }

  public parseContent(content: string | TextDocument, previous?: Syntax): Syntax {
    const document =
      typeof content === "string" ? TextDocument.create("file:///syntax.nss", "nwscript", 0, content) : TextDocument.create(content.uri, content.languageId, content.version, content.getText());
    if (!previous) return Syntax.create(document);
    previous.update(document);
    return previous;
  }

  public indexContent(content: string | TextDocument): SyntaxIndex {
    const syntax = this.parseContent(content);
    try {
      return syntax.getIndex(true);
    } finally {
      syntax.dispose();
    }
  }
}
