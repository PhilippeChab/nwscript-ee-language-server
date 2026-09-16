import { join } from "path";
import { CompletionItemKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Node } from "web-tree-sitter";
import SyntaxDocument from "../src/Tokenizer/SyntaxDocument";
import type { ComplexToken } from "../src/Tokenizer/types";

export type Scope = { id: number; parent?: Scope; symbols: Map<string, BoundSymbol> };
export type BoundSymbol = { id: number; declaration: ComplexToken; offset: number; scope: Scope; references: Reference[] };
export type Reference = { name: string; offset: number; scope: Scope; symbol?: BoundSymbol };

// A single-document snapshot, rebuilt after edits. This is not a production resolver.
export class BindingModel {
  public readonly scopes: Scope[] = [];
  public readonly symbols: BoundSymbol[] = [];
  public readonly references: Reference[] = [];

  public readonly document: TextDocument;

  constructor(syntax: SyntaxDocument, document: TextDocument) {
    this.document = TextDocument.create(document.uri, document.languageId, document.version, document.getText());
    const index = syntax.getIndex();
    const declarations = [...index.globalDeclarations, ...(index.entryPointDeclarations || []), ...(index.localDeclarations || [])];
    const tokens = declarations.flatMap((token) => ("params" in token ? token.params : [token]));
    const variables = new Map(
      tokens
        .filter((token) => new Set<number>([CompletionItemKind.Variable, CompletionItemKind.Constant, CompletionItemKind.TypeParameter]).has(token.tokenType))
        .map((token) => [document.offsetAt(token.position), token]),
    );
    this.visit(syntax.rootNode, this.createScope(), variables);
  }

  public symbolAt(offset: number) {
    return (
      this.symbols.find((symbol) => symbol.offset <= offset && offset < symbol.offset + symbol.declaration.identifier.length) ||
      this.references.find((reference) => reference.offset <= offset && offset < reference.offset + reference.name.length)?.symbol
    );
  }

  private createScope(parent?: Scope): Scope {
    const scope = { id: this.scopes.length, parent, symbols: new Map<string, BoundSymbol>() };
    this.scopes.push(scope);
    return scope;
  }

  private visit(node: Node, scope: Scope, declarations: Map<number, ComplexToken>) {
    if (["comment", "preproc_include", "preproc_def", "struct_declarator", "struct_specifier"].includes(node.type)) return;
    if (node.type === "function_definition" || node.type === "compound_statement") scope = this.createScope(scope);
    if (node.type === "identifier") {
      const declaration = declarations.get(node.startIndex);
      if (declaration) {
        const symbol: BoundSymbol = { id: this.symbols.length, declaration, offset: node.startIndex, scope, references: [] };
        scope.symbols.set(declaration.identifier, symbol);
        this.symbols.push(symbol);
      } else {
        // Calls and function declaration names need a separate function namespace/model.
        if (node.parent?.type === "call_expression" && node.parent.childForFieldName("function")?.id === node.id) return;
        if (node.parent?.type === "function_definition" && node.parent.childForFieldName("declarator")?.id === node.id) return;
        let symbol: BoundSymbol | undefined;
        for (let visible: Scope | undefined = scope; visible && !symbol; visible = visible.parent) symbol = visible.symbols.get(node.text);
        const reference = { name: node.text, offset: node.startIndex, scope, symbol };
        this.references.push(reference);
        symbol?.references.push(reference);
      }
      return;
    }
    for (const child of node.namedChildren) if (child) this.visit(child, scope, declarations);
  }
}

export const example = `int value;
void Fn(int value)
{
    int copy = value;
    {
        int value = 2;
        copy = value;
    }
    copy = value;
}
void Other()
{
    value = 3;
}
`;

async function main() {
  await SyntaxDocument.loadGrammar(join(__dirname, "../resources"));
  const document = TextDocument.create("file:///binding-example.nss", "nwscript", 1, example);
  const syntax = SyntaxDocument.create(document);
  try {
    const model = new BindingModel(syntax, document);
    const location = (offset: number) => {
      const position = document.positionAt(offset);
      return `${position.line + 1}:${position.character + 1}`;
    };
    console.log(example);
    for (const symbol of model.symbols) {
      console.log(
        `symbol #${symbol.id}: ${symbol.declaration.identifier} declared at ${location(symbol.offset)}, scope #${symbol.scope.id}; uses: ${
          symbol.references.map((reference) => location(reference.offset)).join(", ") || "none"
        }`,
      );
    }
    const use = example.indexOf("copy = value;", example.indexOf("int value = 2;")) + "copy = ".length;
    const target = model.symbolAt(use);
    console.log(`\nDefinition of value at ${location(use)}: ${target ? location(target.offset) : "unresolved"}`);
    console.log(`Rename candidates for that symbol: ${target ? [target.offset, ...target.references.map((reference) => reference.offset)].map(location).join(", ") : "none"}`);
  } finally {
    syntax.dispose();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
