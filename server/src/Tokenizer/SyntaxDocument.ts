import { join } from "path";
import type { Language as SyntaxLanguage, Parser as SyntaxParser, Node, Tree } from "web-tree-sitter";
import { CompletionItemKind, Range } from "vscode-languageserver";
import type { Position } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentTokenizationResult, LocalScopeTokenizationResult, AutoImportContext } from "./contracts";
import type { FunctionComplexToken, FunctionParamComplexToken, VariableComplexToken } from "./types";
import { LanguageTypes } from "./constants";
// Select the CJS runtime so bundled Node entry points retain their module filename.
import TreeSitter = require("web-tree-sitter");
const { Language, Parser } = TreeSitter;

const isNode = (node: Node | null): node is Node => node !== null;

export default class SyntaxDocument {
  private static language: SyntaxLanguage;
  private static initialization?: Promise<void>;
  private static readonly cleanup = new FinalizationRegistry<{ tree: Tree; parser: SyntaxParser }>((resources) => {
    resources.tree.delete();
    resources.parser.delete();
  });

  private readonly resources: { tree: Tree; parser: SyntaxParser };
  private index?: DocumentTokenizationResult;

  private source: string;

  private constructor(private document: TextDocument, private readonly parser: SyntaxParser, private tree: Tree) {
    this.source = document.getText();
    this.resources = { tree, parser };
    SyntaxDocument.cleanup.register(this, this.resources, this);
  }

  public static async loadGrammar(directory: string) {
    return await (this.initialization ||= this.initialize(directory));
  }

  public static create(document: TextDocument) {
    const parser = new Parser();
    parser.setLanguage(this.language);
    const tree = parser.parse(document.getText());
    if (!tree) {
      parser.delete();
      throw new Error("Tree-sitter did not produce a syntax tree");
    }
    return new SyntaxDocument(document, parser, tree);
  }

  public get rootNode() {
    return this.tree.rootNode;
  }

  public dispose() {
    SyntaxDocument.cleanup.unregister(this);
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
    this.resources.tree = next;
    this.index = undefined;
    this.source = after;
    this.document = document;
  }

  public getFunctionNavigationTarget(identifier: string, position?: Position): Position | undefined {
    const declarations = this.rootNode.namedChildren.filter(isNode).filter((node) => node.type === "function_definition" && node.childForFieldName("declarator")?.text === identifier);
    const offset = position ? this.document.offsetAt(position) : undefined;
    const current = declarations.find((node) => {
      const name = node.childForFieldName("declarator");
      return name && offset !== undefined && name.startIndex <= offset && offset <= name.endIndex;
    });
    // Calls and prototypes prefer a body; clicking the body's name toggles to a prototype.
    const implementation = declarations.find((node) => node.childForFieldName("body"));
    const prototype = declarations.find((node) => !node.childForFieldName("body"));
    const target = current?.childForFieldName("body") ? prototype || implementation : implementation || prototype;
    const name = target?.childForFieldName("declarator");
    return name ? this.position(name) : undefined;
  }

  public getIndex(strict = false): DocumentTokenizationResult {
    if (
      strict &&
      (this.rootNode.namedChildren.some((node) => node?.isError && node.namedChildren.some((child) => child?.type === "primitive_type")) ||
        this.rootNode.descendantsOfType(["struct_declarator", "function_argument_list"]).some((node) => node?.hasError))
    ) {
      throw new Error("Incomplete declaration");
    }
    if (this.index) return this.index;
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
          position: this.position(name),
          identifier: name.text,
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
              position: variable.position,
              identifier: variable.identifier,
              tokenType: CompletionItemKind.Constant,
              valueType: variable.valueType,
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
    this.index = index;
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
          visible.push(...this.variables(child).filter((variable) => this.document.offsetAt(variable.position) <= offset));
        }
      } else if (node.type === "function_definition") {
        visible.push(...(this.readFunction(node)?.params || []).filter((param) => this.document.offsetAt(param.position) <= offset));
        break;
      }
    }
    return visible;
  }

  public getLocalScope(position?: Position, startLine = 0): LocalScopeTokenizationResult {
    const offset = position ? this.document.offsetAt(position) : this.source.length;
    const functionsComplexTokens = [...this.walk(this.rootNode)]
      .filter((node) => node.type === "function_definition" && node.childForFieldName("body") && node.startIndex < offset && this.position(node).line >= startLine)
      .flatMap((node) => {
        const fn = this.readFunction(node);
        if (!fn) return [];
        delete fn.implementation;
        fn.variables = [...this.walk(node)]
          .filter((child) => child.type === "declaration")
          .flatMap((child) => this.variables(child))
          .filter((variable) => this.document.offsetAt(variable.position) <= offset)
          .sort((a, b) => b.position.line - a.position.line || a.position.character - b.position.character);
        return [fn];
      })
      .reverse();
    return { functionsComplexTokens, functionVariablesComplexTokens: position ? this.getVisibleLocals(position) : functionsComplexTokens.flatMap((fn) => [...(fn.variables || []), ...fn.params]) };
  }

  public getCallContext(position: Position) {
    if (this.isInCommentOrString(position)) return;
    const offset = this.document.offsetAt(position);
    const calls: { identifier?: string; activeParameter: number }[] = [];
    let previous: Node | undefined;
    // Syntax leaves also retain delimiters in incomplete ERROR expressions.
    for (const leaf of this.leaves()) {
      if (leaf.startIndex >= offset) break;
      if (["(", "["].includes(leaf.type)) {
        const declaration = previous && this.ancestor(previous, ["function_definition"]);
        calls.push({
          identifier: leaf.type === "(" && previous?.type === "identifier" && declaration?.childForFieldName("declarator")?.id !== previous.id ? previous.text : undefined,
          activeParameter: 0,
        });
      } else if ([")", "]"].includes(leaf.type)) calls.pop();
      else if (leaf.type === "," && calls.length) calls[calls.length - 1].activeParameter++;
      previous = leaf;
    }
    return calls.reverse().find((call) => call.identifier !== undefined);
  }

  public getMemberPath(position: Position) {
    if (this.isInCommentOrString(position)) return;
    const offset = this.document.offsetAt(position);
    const leaves = [...this.leaves()].filter((node) => node.startIndex < offset || (node.startIndex === offset && ["identifier", "field_identifier"].includes(node.type)));
    const names: string[] = [];
    let expectName = true;
    let member = false;
    for (const node of leaves.reverse()) {
      if (!names.length && node.type === ".") {
        names.push("");
        member = true;
      } else if (expectName && ["identifier", "field_identifier"].includes(node.type)) {
        names.push(node.text);
        expectName = false;
      } else if (!expectName && node.type === ".") {
        expectName = true;
        member = true;
      } else break;
    }
    return member ? (!expectName && names.length > 1 ? names.reverse() : []) : undefined;
  }

  public getActionTarget(position: Position) {
    if (this.isInCommentOrString(position)) return { rawContent: undefined, tokenType: undefined };
    const offset = this.document.offsetAt(position);
    const leaves = [...this.leaves()];
    const node = leaves.find((leaf) => leaf.startIndex === offset && leaf.isNamed) || leaves.find((leaf) => leaf.startIndex <= offset && leaf.endIndex >= offset);
    const tokenType =
      node?.type === "type_identifier" || ["struct_declarator", "struct_specifier"].includes(node?.parent?.type || "")
        ? CompletionItemKind.Struct
        : node?.type === "field_identifier"
        ? CompletionItemKind.Property
        : undefined;
    return { rawContent: node?.text, tokenType };
  }

  public getAutoImportContext(position: Position): AutoImportContext | undefined {
    if (this.isInCommentOrString(position)) return;
    const offset = this.document.offsetAt(position);
    const leaves = [...this.leaves()];
    const leaf = leaves.find((node) => node.startIndex < offset && node.endIndex >= offset);
    if (leaf && this.ancestor(leaf, ["preproc_include"])) return;
    if (this.getMemberPath(position)) return;
    const identifier = leaf && ["identifier", "type_identifier", "field_identifier"].includes(leaf.type) ? leaf : undefined;
    const start = identifier?.startIndex ?? offset;
    const previous = leaves.filter((node) => node.endIndex <= start).at(-1);
    const insertionPosition = this.getIncludeInsertionPosition();
    if (this.document.offsetAt(insertionPosition) > start) return;
    return {
      prefix: this.source.slice(start, offset),
      replacementRange: Range.create(this.document.positionAt(start), this.document.positionAt(identifier?.endIndex ?? offset)),
      insertionPosition,
      structsOnly: previous?.type === "struct",
    };
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

  private static async initialize(directory: string) {
    // The runtime accepts module overrides; its declaration incorrectly requires a complete module.
    await Parser.init({ locateFile: () => join(directory, "web-tree-sitter.wasm") } as unknown as EmscriptenModule);
    this.language = await Language.load(join(directory, "tree-sitter-nwscript.wasm"));
  }

  private getIncludeInsertionPosition(): Position {
    let end = 0;
    for (const node of this.rootNode.namedChildren.filter(isNode)) {
      if (!["comment", "preproc_include"].includes(node.type)) break;
      end = node.startIndex + node.text.trimEnd().length;
    }
    if (!end) return { line: 0, character: 0 };
    const newline = this.source.indexOf("\n", end);
    if (newline >= 0 && !this.source.slice(end, newline).trim()) end = newline + 1;
    return this.document.positionAt(end);
  }

  private *leaves(node = this.rootNode): Generator<Node> {
    if (node.type === "comment" || node.isMissing) return;
    if (!node.childCount || ["string_literal", "raw_string_literal", "hashed_string_literal"].includes(node.type)) {
      yield node;
      return;
    }
    for (const child of node.children.filter(isNode)) yield* this.leaves(child);
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
          position: variable.position,
          identifier: variable.identifier,
          tokenType: CompletionItemKind.TypeParameter,
          valueType: variable.valueType,
          ...(parameter.childForFieldName("default") ? { defaultValue: parameter.childForFieldName("default")?.text } : {}),
        })),
      );
    const comments: string[] = [];
    let adjacentLine = this.position(node).line;
    for (let previous = node.previousNamedSibling; previous?.type === "comment" && previous.endPosition.row === adjacentLine - 1; previous = previous.previousNamedSibling) {
      comments.unshift(...previous.text.replace(/\r$/, "").split(/\r?\n/));
      adjacentLine = previous.startPosition.row;
    }
    return {
      position: this.position(name),
      identifier: name.text,
      tokenType: CompletionItemKind.Function,
      returnType: this.valueType(node),
      params,
      signatureEnd: this.document.positionAt(args.endIndex),
      comments,
      ...(node.childForFieldName("body") ? { implementation: true as const } : {}),
    };
  }
}
