import { join } from "path";
import { Language, Parser } from "web-tree-sitter";
import type { Node, Tree } from "web-tree-sitter";
import { CompletionItemKind } from "vscode-languageserver";
import type { Position } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentTokenizationResult } from "../../src/Tokenizer/Tokenizer";
import type { FunctionComplexToken, FunctionParamComplexToken, VariableComplexToken } from "../../src/Tokenizer/types";
import { LanguageTypes } from "../../src/Tokenizer/constants";

const isNode = (node: Node | null): node is Node => node !== null;

// Experimental syntax adapter. No production provider selects this backend.
export default class TreeSitterDocument {
  private static language: Promise<Language> | undefined;

  private source: string;

  private constructor(private document: TextDocument, private readonly parser: Parser, private tree: Tree) {
    this.source = document.getText();
  }

  public static async create(document: TextDocument) {
    this.language ||= Parser.init().then(async () => await Language.load(join(__dirname, "grammar/tree-sitter-nwscript.wasm")));
    const language = await this.language;
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(document.getText());
    if (!tree) {
      parser.delete();
      throw new Error("Tree-sitter did not produce a syntax tree");
    }
    return new TreeSitterDocument(document, parser, tree);
  }

  public get rootNode() {
    return this.tree.rootNode;
  }

  public dispose() {
    this.tree.delete();
    this.parser.delete();
  }

  public update(document: TextDocument) {
    const before = this.source;
    const after = document.getText();
    if (before === after) {
      this.document = document;
      return;
    }
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let oldEnd = before.length;
    let newEnd = after.length;
    while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    this.tree.edit({
      startIndex: start,
      oldEndIndex: oldEnd,
      newEndIndex: newEnd,
      startPosition: this.point(before, start),
      oldEndPosition: this.point(before, oldEnd),
      newEndPosition: this.point(after, newEnd),
    });
    const next = this.parser.parse(after, this.tree);
    if (!next) throw new Error("Tree-sitter did not produce an updated syntax tree");
    this.tree.delete();
    this.tree = next;
    this.source = after;
    this.document = document;
  }

  public getIndex(): DocumentTokenizationResult {
    const index: DocumentTokenizationResult = { globalDeclarations: [], structDeclarations: [], children: [] };
    for (const node of this.walk(this.rootNode)) {
      if (node.type === "preproc_include") {
        const file = node.childForFieldName("file");
        if (file && !file.hasError) {
          index.children.push(file.text.slice(1, -1));
          (index.includePositions ||= []).push(this.position(node));
        }
      } else if (node.type === "function_definition") {
        const fn = this.readFunction(node);
        if (!fn) continue;
        if (fn.implementation && (fn.identifier === "main" || fn.identifier === "StartingConditional")) {
          (index.entryPointDeclarations ||= []).push(fn);
          continue;
        }
        const existing = index.globalDeclarations.find((token): token is FunctionComplexToken => token.tokenType === CompletionItemKind.Function && token.identifier === fn.identifier);
        if (!existing) index.globalDeclarations.push(fn);
        else {
          if (fn.implementation) existing.implementation = true;
          if (fn.params.length) (index.localDeclarations ||= []).push(...fn.params);
        }
      } else if (node.type === "struct_declarator") {
        const name = node.childForFieldName("declarator");
        if (!name || name.isMissing) continue;
        const fields = node.namedChildren.filter(isNode).find((child) => child.type === "struct_members");
        index.structDeclarations.push({
          identifier: name.text,
          position: this.position(name),
          tokenType: CompletionItemKind.Struct,
          properties: (fields?.namedChildren.filter(isNode) || [])
            .filter((child) => child.type === "field_declaration")
            .flatMap((field) => this.variables(field).map((variable) => ({ ...variable, tokenType: CompletionItemKind.Property }))),
        });
      } else if (node.type === "declaration") {
        const variables = this.variables(node);
        if (this.ancestor(node.parent, ["compound_statement", "for_statement"])) (index.localDeclarations ||= []).push(...variables);
        else {
          const declarators = node.childrenForFieldName("declarator").filter(isNode);
          for (const variable of variables) {
            const declarator = declarators.find((child) => (child.childForFieldName("declarator") || child).text === variable.identifier);
            index.globalDeclarations.push({
              ...variable,
              tokenType: CompletionItemKind.Constant,
              value: declarator?.childForFieldName("value")?.text || "",
              ...(node.namedChildren.filter(isNode).some((child) => child.type === "const_qualifier") ? { isConst: true as const } : {}),
            });
          }
        }
      } else if (node.type === "field_expression") {
        const member = node.childForFieldName("field");
        if (member && !member.isMissing) (index.memberReferences ||= []).push({ identifier: member.text, position: this.position(member), tokenType: CompletionItemKind.Reference });
      }
    }
    return index;
  }

  public getVisibleLocals(position: Position): (VariableComplexToken | FunctionParamComplexToken)[] {
    const offset = this.document.offsetAt(position);
    const visible: (VariableComplexToken | FunctionParamComplexToken)[] = [];
    for (let node: Node | null = this.rootNode.descendantForIndex(offset); node; node = node.parent) {
      if (node.type === "compound_statement" || node.type === "for_statement") {
        for (const child of node.namedChildren
          .filter(isNode)
          .filter((child) => child.type === "declaration")
          .reverse()) {
          visible.push(...this.variables(child).filter((variable) => this.document.offsetAt(variable.position) < offset));
        }
      } else if (node.type === "function_definition") {
        visible.push(...(this.readFunction(node)?.params || []));
        break;
      }
    }
    return visible;
  }

  public getCallContext(position: Position) {
    const offset = this.document.offsetAt(position);
    if (this.isInCommentOrString(position)) return;
    const node = this.rootNode.descendantForIndex(Math.max(0, offset - 1));
    const args = this.ancestor(node, ["argument_list"]);
    const fn = args?.parent?.childForFieldName("function");
    if (args && fn) return { identifier: fn.text, activeParameter: args.children.filter(isNode).filter((child) => child.type === "," && child.startIndex < offset).length };
  }

  public getMemberAccess(position: Position) {
    const offset = this.document.offsetAt(position);
    const node = this.rootNode.descendantForIndex(offset);
    const field = this.ancestor(node, ["field_expression"]);
    if (field && offset >= (field.childForFieldName("field")?.startIndex ?? Number.POSITIVE_INFINITY)) {
      return { receiver: field.childForFieldName("argument")?.text, member: field.childForFieldName("field")?.text };
    }
  }

  public isInCommentOrString(position: Position) {
    const offset = this.document.offsetAt(position);
    const node = this.rootNode.descendantForIndex(Math.max(0, offset - 1));
    const literal = this.ancestor(node, ["string_literal", "raw_string_literal", "hashed_string_literal"]);
    if (literal) return offset < literal.endIndex || literal.hasError;
    const comment = this.ancestor(node, ["comment"]);
    if (comment) return offset < comment.endIndex || comment.text.startsWith("//");
    return Boolean(this.ancestor(node, ["raw_string_start", "raw_string_content", "raw_string_escape", "string_start", "string_content", "hashed_string_start"]));
  }

  private *walk(node: Node): Generator<Node> {
    if (node.isError) return;
    yield node;
    for (const child of node.namedChildren.filter(isNode)) yield* this.walk(child);
  }

  private ancestor(node: Node | null, types: string[]): Node | undefined {
    while (node) {
      if (types.includes(node.type)) return node;
      node = node.parent;
    }
  }

  private point(text: string, offset: number) {
    const prefix = text.slice(0, offset);
    return { row: prefix.split("\n").length - 1, column: prefix.length - prefix.lastIndexOf("\n") - 1 };
  }

  private position(node: Node) {
    // web-tree-sitter's string input exposes UTF-16 indexes, unlike the native API.
    return this.document.positionAt(node.startIndex);
  }

  private valueType(node: Node): LanguageTypes {
    const type = node.childForFieldName("type");
    return (type?.type === "struct_specifier" ? type.namedChildren.filter(isNode)[0]?.text : type?.text) as LanguageTypes;
  }

  private variables(node: Node): VariableComplexToken[] {
    return node
      .childrenForFieldName("declarator")
      .filter(isNode)
      .flatMap((declarator) => {
        const name = declarator.childForFieldName("declarator") || declarator;
        if (name.isMissing || !["identifier", "field_identifier"].includes(name.type)) return [];
        return [{ identifier: name.text, position: this.position(name), valueType: this.valueType(node), tokenType: CompletionItemKind.Variable }];
      });
  }

  private readFunction(node: Node): FunctionComplexToken | undefined {
    const name = node.childForFieldName("declarator");
    const args = node.namedChildren.filter(isNode).find((child) => child.type === "function_argument_list");
    if (!name || name.isMissing || !args) return;
    const params: FunctionParamComplexToken[] = args.namedChildren
      .filter(isNode)
      .filter((child) => child.type === "parameter_declaration")
      .flatMap((parameter) =>
        this.variables(parameter).map((variable) => ({
          ...variable,
          tokenType: CompletionItemKind.TypeParameter,
          ...(parameter.childForFieldName("default") ? { defaultValue: parameter.childForFieldName("default")?.text } : {}),
        })),
      );
    const comments: string[] = [];
    for (let previous = node.previousNamedSibling; previous?.type === "comment"; previous = previous.previousNamedSibling) comments.unshift(...previous.text.split(/\r?\n/));
    return {
      tokenType: CompletionItemKind.Function,
      identifier: name.text,
      position: this.position(name),
      returnType: this.valueType(node),
      params,
      comments,
      signatureEnd: this.document.positionAt(args.endIndex),
      ...(node.childForFieldName("body") ? { implementation: true as const } : {}),
    };
  }
}
