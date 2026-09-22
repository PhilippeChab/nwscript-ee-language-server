import { DeclarationKind } from "./Declarations";
import type { NamedLocation, FunctionDeclaration, ParameterDeclaration, VariableDeclaration } from "./Declarations";
import { ReferenceKind } from "./References";
import type { SyntaxIndex } from "./SyntaxIndex";
import type { LocalScope, AutoImportContext, CallContext, SyntaxTarget } from "./SyntaxTypes";
import type { TypeName } from "./TypeNames";
import { join } from "path";
import { Edit, Language, Parser } from "web-tree-sitter";
import type { Node, Tree } from "web-tree-sitter";
import { Range } from "vscode-languageserver";
import type { Position } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { isStandardLibrary } from "../Utils/Uri";

const isNode = (node: Node | null): node is Node => node !== null;

export default class Syntax {
  private static language: Language;
  private static initialization?: Promise<void>;
  private static readonly cleanup = new FinalizationRegistry<{ tree: Tree; parser: Parser }>((resources) => {
    resources.tree.delete();
    resources.parser.delete();
  });

  private readonly resources: { tree: Tree; parser: Parser };
  private index?: SyntaxIndex;

  private source: string;

  private constructor(
    private document: TextDocument,
    private readonly parser: Parser,
    private tree: Tree,
  ) {
    this.source = document.getText();
    this.resources = { tree, parser };
    Syntax.cleanup.register(this, this.resources, this);
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
    return new Syntax(document, parser, tree);
  }

  public get hasSyntaxErrors() {
    return this.rootNode.hasError || this.rootNode.namedChildren.some((node) => node?.type === "incomplete_function_definition");
  }

  public get rootNode() {
    return this.tree.rootNode;
  }

  public dispose() {
    Syntax.cleanup.unregister(this);
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
    this.tree.edit(
      new Edit({
        startIndex: start,
        oldEndIndex: oldEnd,
        newEndIndex: newEnd,
        startPosition: this.point(before, start),
        oldEndPosition: this.point(before, oldEnd),
        newEndPosition: this.point(after, newEnd),
      }),
    );
    const next = this.parser.parse(after, this.tree);
    if (!next) throw new Error("Tree-sitter did not produce an updated syntax tree");
    this.tree.delete();
    this.tree = next;
    this.resources.tree = this.tree;
    this.index = undefined;
    this.source = after;
    this.document = document;
  }

  public getFunctionDeclarations(): FunctionDeclaration[] {
    return this.rootNode.namedChildren
      .filter(isNode)
      .filter((node) => node.type === "function_definition")
      .flatMap((node) => {
        const declaration = this.readFunction(node);
        return declaration ? [declaration] : [];
      });
  }

  public getIndex(strict = false): SyntaxIndex {
    if (
      strict &&
      (this.rootNode.namedChildren.some((node) => node?.type === "incomplete_function_definition") ||
        this.rootNode.namedChildren.some((node) => node?.isError && node.namedChildren.some((child) => child?.type === "primitive_type" || child?.type === "void_type")) ||
        this.rootNode.descendantsOfType(["struct_declarator", "function_argument_list"]).some((node) => node?.hasError))
    ) {
      throw new Error("Incomplete declaration");
    }
    if (this.index) return this.index;
    const index: SyntaxIndex = { globalDeclarations: [], structDeclarations: [], includes: [] };
    for (const node of this.walk(this.rootNode)) {
      if (node.type === "preproc_include") {
        const file = node.childForFieldName("file");
        if (file && !file.hasError) {
          index.includes.push({ name: file.text.slice(1, -1), position: this.position(node) });
        }
      } else if (node.type === "function_definition") {
        const fn = this.readFunction(node);
        if (!fn) continue;
        if (fn.implementation && (fn.identifier === "main" || fn.identifier === "StartingConditional")) {
          (index.entryPointDeclarations ||= []).push(fn);
          continue;
        }
        const existing = index.globalDeclarations.find((declaration): declaration is FunctionDeclaration => declaration.kind === DeclarationKind.Function && declaration.identifier === fn.identifier);
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
          kind: DeclarationKind.Struct,
          properties: (fields?.namedChildren.filter(isNode) || [])
            .filter((child) => child.type === "field_declaration")
            .flatMap((field) => this.readDeclarators(field).map(({ identifier, position, valueType }) => ({ identifier, position, valueType, kind: DeclarationKind.Field }))),
        });
      } else if (node.type === "declaration") {
        if (this.ancestor(node.parent, ["compound_statement", "for_statement"])) (index.localDeclarations ||= []).push(...this.readLocalVariables(node));
        else {
          const declarators = node.childrenForFieldName("declarator").filter(isNode);
          for (const variable of this.readDeclarators(node)) {
            const declarator = declarators.find((child) => (child.childForFieldName("declarator") || child).text === variable.identifier);
            const isConst = node.namedChildren.filter(isNode).some((child) => child.type === "const_qualifier");
            const classification =
              isConst || isStandardLibrary(this.document.uri)
                ? { kind: DeclarationKind.Constant as const, ...(isConst ? { isConst: true as const } : {}) }
                : { kind: DeclarationKind.Variable as const, scope: "global" as const };
            index.globalDeclarations.push({
              position: variable.position,
              identifier: variable.identifier,
              ...classification,
              valueType: variable.valueType,
              value: declarator?.childForFieldName("value")?.text || "",
            });
          }
        }
      } else if (node.type === "field_expression") {
        const member = node.childForFieldName("field");
        if (member && !member.isMissing) (index.memberReferences ||= []).push({ identifier: member.text, position: this.position(member), kind: ReferenceKind.Member });
      }
    }
    this.index = index;
    return index;
  }

  public getLocalScope(position?: Position): LocalScope {
    const offset = position ? this.document.offsetAt(position) : this.source.length;
    const functionDeclarations = [...this.walk(this.rootNode)]
      .filter((node) => node.type === "function_definition" && node.childForFieldName("body") && node.startIndex < offset)
      .flatMap((node) => {
        const fn = this.readFunction(node);
        if (!fn) return [];
        delete fn.implementation;
        fn.variables = [...this.walk(node)]
          .filter((child) => child.type === "declaration")
          .flatMap((child) => this.readLocalVariables(child))
          .filter((variable) => this.document.offsetAt(variable.position) <= offset)
          .sort((a, b) => b.position.line - a.position.line || a.position.character - b.position.character);
        return [fn];
      })
      .reverse();
    return { functionDeclarations, variableDeclarations: position ? this.getVisibleLocals(position) : functionDeclarations.flatMap((fn) => [...(fn.variables || []), ...fn.params]) };
  }

  public getCallContext(position: Position): CallContext | undefined {
    if (this.isInCommentOrString(position)) return;
    const offset = this.document.offsetAt(position);
    const calls: { identifier?: string; activeParameter: number }[] = [];
    let previous: Node | undefined;
    // Syntax leaves also retain delimiters in incomplete ERROR expressions.
    for (const leaf of this.leaves()) {
      if (leaf.startIndex >= offset) break;
      if (["(", "["].includes(leaf.type)) {
        const declaration = previous && this.ancestor(previous, ["function_definition", "incomplete_function_definition"]);
        calls.push({
          identifier: leaf.type === "(" && previous?.type === "identifier" && declaration?.childForFieldName("declarator")?.id !== previous.id ? previous.text : undefined,
          activeParameter: 0,
        });
      } else if ([")", "]"].includes(leaf.type)) calls.pop();
      else if (leaf.type === "," && calls.length) calls[calls.length - 1].activeParameter++;
      previous = leaf;
    }
    const call = calls.reverse().find((call) => call.identifier !== undefined);
    return call?.identifier !== undefined ? { identifier: call.identifier, activeParameter: call.activeParameter } : undefined;
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

  public getTargetAt(position: Position): SyntaxTarget | undefined {
    if (this.isInCommentOrString(position)) return;
    const offset = this.document.offsetAt(position);
    const leaves = [...this.leaves()];
    const node = leaves.find((leaf) => leaf.startIndex === offset && leaf.isNamed) || leaves.find((leaf) => leaf.startIndex <= offset && leaf.endIndex >= offset);
    if (!node?.text) return;
    const kind =
      node.type === "type_identifier" || ["struct_declarator", "struct_specifier"].includes(node.parent?.type || "")
        ? ReferenceKind.Type
        : node.type === "field_identifier"
          ? ReferenceKind.Member
          : undefined;
    return { identifier: node.text, kind, range: Range.create(this.document.positionAt(node.startIndex), this.document.positionAt(node.endIndex)) };
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
    if (comment) return offset < comment.endIndex || comment.text.startsWith("//") || !comment.text.endsWith("*/");
    return Boolean(this.ancestor(node, ["raw_string_start", "raw_string_content", "raw_string_escape", "string_start", "string_content", "hashed_string_start"]));
  }

  private static async initialize(directory: string) {
    await Parser.init({ locateFile: () => join(directory, "web-tree-sitter.wasm") });
    this.language = await Language.load(join(directory, "tree-sitter-nwscript.wasm"));
  }

  private getVisibleLocals(position: Position): (VariableDeclaration | ParameterDeclaration)[] {
    const offset = this.document.offsetAt(position);
    const visible: (VariableDeclaration | ParameterDeclaration)[] = [];
    for (let node: Node | null = this.rootNode.descendantForIndex(offset); node; node = node.parent) {
      if (node.type === "compound_statement" || node.type === "for_statement") {
        for (const child of node.namedChildren
          .filter(isNode)
          .filter((child) => child.type === "declaration")
          .reverse()) {
          visible.push(...this.readLocalVariables(child).filter((variable) => this.document.offsetAt(variable.position) <= offset));
        }
      } else if (node.type === "function_definition") {
        visible.push(...(this.readFunction(node)?.params || []).filter((param) => this.document.offsetAt(param.position) <= offset));
        break;
      }
    }
    return visible;
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

  private getTypeName(node: Node): TypeName | undefined {
    const type = node.childForFieldName("type");
    return type?.type === "struct_specifier" ? type.namedChildren.filter(isNode)[0]?.text : type?.text;
  }

  private readLocalVariables(node: Node): VariableDeclaration[] {
    return this.readDeclarators(node).map((declaration) => ({ ...declaration, kind: DeclarationKind.Variable, scope: "local" }));
  }

  private readDeclarators(node: Node): (NamedLocation & { valueType: TypeName })[] {
    const valueType = this.getTypeName(node);
    if (!valueType) return [];
    return node
      .childrenForFieldName("declarator")
      .filter(isNode)
      .flatMap((declarator) => {
        const name = declarator.childForFieldName("declarator") || declarator;
        if (name.isMissing || !["identifier", "field_identifier"].includes(name.type)) return [];
        return [{ identifier: name.text, position: this.position(name), valueType }];
      });
  }

  private readFunction(node: Node): FunctionDeclaration | undefined {
    const returnType = this.getTypeName(node);
    const name = node.childForFieldName("declarator");
    const args = node.namedChildren.filter(isNode).find((child) => child.type === "function_argument_list");
    if (!name || name.isMissing || !args || !returnType) return;
    const params: ParameterDeclaration[] = args.namedChildren
      .filter(isNode)
      .filter((child) => child.type === "parameter_declaration")
      .flatMap((parameter) =>
        this.readDeclarators(parameter).map((variable) => ({
          position: variable.position,
          identifier: variable.identifier,
          kind: DeclarationKind.Parameter,
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
      kind: DeclarationKind.Function,
      returnType,
      params,
      signatureEnd: this.document.positionAt(args.endIndex),
      comments,
      ...(node.childForFieldName("body") ? { implementation: true as const } : {}),
    };
  }
}
