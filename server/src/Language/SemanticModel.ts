import { Position } from "vscode-languageserver";
import { DeclarationKind } from "./Declarations";
import type { Declaration, FunctionDeclaration, StructDeclaration } from "./Declarations";
import { ReferenceKind } from "./References";
import { BuiltinType } from "./TypeNames";
import { isSymbolOfKind } from "./SemanticTypes";
import type { SemanticInput, SourcedDeclaration, SemanticSymbol, SymbolBinding, SemanticWorkspace, CompletionContext, ResolvedCall, DefinitionTarget } from "./SemanticTypes";
import type Syntax from "./Syntax";

const vectorType: StructDeclaration = {
  identifier: BuiltinType.vector,
  kind: DeclarationKind.Struct,
  position: Position.create(0, 0),
  properties: ["x", "y", "z"].map((identifier) => ({ identifier, valueType: BuiltinType.float, kind: DeclarationKind.Field, position: Position.create(0, 0) })),
};

export default class SemanticModel {
  private readonly symbols = new Map<string, SemanticSymbol>();
  private readonly bindings = new Map<string, SymbolBinding>();
  private readonly globals: SourcedDeclaration[];
  private readonly structs: SourcedDeclaration[];

  constructor(
    private readonly syntax: Syntax,
    readonly inputs: readonly SemanticInput[],
    private readonly workspace: SemanticWorkspace,
  ) {
    this.globals = inputs.flatMap((source) => source.index.globalDeclarations.map((declaration) => ({ declaration, source })));
    this.structs = inputs.flatMap((source) => source.index.structDeclarations.map((declaration) => ({ declaration, source })));
    // The index combines prototype/body metadata for presentation. Syntax keeps
    // the actual declaration sites and their individual implementation flags.
    const canonicalFunctions = new Map(
      inputs[0].index.globalDeclarations.filter((declaration) => declaration.kind === DeclarationKind.Function).map((declaration) => [declaration.identifier, declaration]),
    );
    const functions = new Map<string, FunctionDeclaration[]>();
    for (const declaration of syntax.getFunctionDeclarations()) {
      const declarations = functions.get(declaration.identifier) || [];
      declarations.push(declaration);
      functions.set(declaration.identifier, declarations);
    }
    for (const declarations of functions.values()) {
      this.getOrCreateSymbol(canonicalFunctions.get(declarations[0].identifier) || declarations[0], inputs[0], declarations);
    }
  }

  public matches(inputs: readonly SemanticInput[]) {
    return inputs.length === this.inputs.length && inputs.every((input, i) => input.uri === this.inputs[i].uri && input.owner === this.inputs[i].owner && input.index === this.inputs[i].index);
  }

  public resolveAt(position: Position): SemanticSymbol | undefined {
    return this.bindAt(position)?.symbol;
  }

  public bindAt(position: Position): SymbolBinding | undefined {
    const target = this.syntax.getTargetAt(position);
    if (!target) return;
    const { identifier, kind, range } = target;
    const key = this.positionKey(range.start);
    const cached = this.bindings.get(key);
    if (cached) return cached;
    const memberPath = this.syntax.getMemberPath(position);
    let symbol: SemanticSymbol | undefined;
    if (memberPath) {
      const struct = this.resolveMemberStruct(position, memberPath.slice(0, -1));
      const declaration = struct?.declaration.properties.find((property) => property.identifier === memberPath[memberPath.length - 1]);
      if (declaration) symbol = this.getOrCreateSymbol(declaration, struct?.source);
    } else {
      const field = this.inputs[0].index.structDeclarations.flatMap((struct) => struct.properties).find((declaration) => this.positionKey(declaration.position) === key);
      if (field) symbol = this.getOrCreateSymbol(field, this.inputs[0]);
      // Unknown receivers must never resolve through the ordinary name namespace.
      else if (kind === ReferenceKind.Type) symbol = this.resolveStructType(identifier);
      else if (kind !== ReferenceKind.Member) symbol = this.resolveValue(position, identifier);
    }
    const binding = { range, symbol };
    this.bindings.set(key, binding);
    return binding;
  }

  public resolveCall(position: Position): ResolvedCall | undefined {
    const call = this.syntax.getCallContext(position);
    if (!call) return;
    const symbol = this.resolveValue(position, call.identifier);
    return isSymbolOfKind(symbol, DeclarationKind.Function) ? { symbol, activeParameter: call.activeParameter } : undefined;
  }

  public getCompletions(position: Position, autoImport: boolean, importLimit: number): CompletionContext {
    if (this.syntax.isInCommentOrString(position)) return { symbols: [], imports: [] };
    const context = this.syntax.getAutoImportContext(position);
    const members = this.getMembers(position);
    if (members) return { symbols: members, imports: [] };
    const symbols = this.getVisibleSymbols(position, context?.structsOnly);
    const autoImportContext = autoImport ? context : undefined;
    const imports = autoImportContext && importLimit > 0 ? this.workspace.getImportCandidates(autoImportContext, new Set(symbols.map((symbol) => symbol.declaration.identifier)), importLimit) : [];
    return { symbols, imports, autoImportContext };
  }

  public getDefinitionAt(position: Position): DefinitionTarget | undefined {
    const symbol = this.resolveAt(position);
    const uri = symbol?.source?.owner;
    if (!symbol || !uri) return;
    return { uri, position: this.getDefinition(symbol, uri === this.inputs[0].uri ? position : undefined) };
  }

  public getDocumentDeclarations(): Declaration[] {
    const { index } = this.inputs[0];
    const scope = this.syntax.getLocalScope();
    const implementations = new Set(scope.functionDeclarations.map((declaration) => declaration.identifier));
    return [
      ...index.globalDeclarations.filter((declaration) => declaration.kind === DeclarationKind.Constant || declaration.kind === DeclarationKind.Variable),
      ...index.structDeclarations,
      ...scope.functionDeclarations,
      ...index.globalDeclarations.filter((declaration) => declaration.kind === DeclarationKind.Function && !implementations.has(declaration.identifier)),
    ];
  }

  private getMembers(position: Position): SemanticSymbol[] | undefined {
    const path = this.syntax.getMemberPath(position);
    if (!path) return;
    const struct = this.resolveMemberStruct(position, path.slice(0, -1));
    return struct ? struct.declaration.properties.map((declaration) => this.getOrCreateSymbol(declaration, struct.source)) : [];
  }

  private getVisibleSymbols(position: Position, structsOnly = false): SemanticSymbol[] {
    if (structsOnly) return this.structs.map(({ declaration, source }) => this.getOrCreateSymbol(declaration, source));
    const scope = this.syntax.getLocalScope(position);
    const source = this.inputs[0];
    const localNames = new Set(scope.functionDeclarations.map((declaration) => declaration.identifier));
    const local = [...scope.variableDeclarations, ...scope.functionDeclarations].map((declaration) => ({ declaration, source }));
    const global = this.globals.filter((symbol) => symbol.source !== source || !localNames.has(symbol.declaration.identifier));
    const seen = new Set<string>();
    return [...local, ...global]
      .filter(({ declaration }) => {
        if (seen.has(declaration.identifier)) return false;
        seen.add(declaration.identifier);
        return true;
      })
      .map(({ declaration, source }) => this.getOrCreateSymbol(declaration, source));
  }

  private getDefinition(symbol: SemanticSymbol, position?: Position): Position {
    if (!isSymbolOfKind(symbol, DeclarationKind.Function)) return symbol.declaration.position;
    const functions = symbol.declarations;
    const implementation = functions.find((declaration) => declaration.implementation);
    const prototype = functions.find((declaration) => !declaration.implementation);
    const current =
      position &&
      functions.find(
        (declaration) =>
          declaration.position.line === position.line && declaration.position.character <= position.character && position.character <= declaration.position.character + declaration.identifier.length,
      );
    return (current?.implementation ? prototype || implementation : implementation || prototype)?.position || symbol.declaration.position;
  }

  private resolveValue(position: Position, name: string): SemanticSymbol | undefined {
    const scope = this.syntax.getLocalScope(position);
    const local = scope.variableDeclarations.find((declaration) => declaration.identifier === name);
    if (local) return this.getOrCreateSymbol(local, this.inputs[0]);
    const global = this.globals.find((symbol) => symbol.declaration.identifier === name);
    if (global) return this.getOrCreateSymbol(global.declaration, global.source);
    const fn = scope.functionDeclarations.find((declaration) => declaration.identifier === name);
    if (fn) return this.getOrCreateSymbol(fn, this.inputs[0]);
  }

  private resolveMemberStruct(position: Position, path: string[]) {
    const root = this.resolveValue(position, path[0])?.declaration;
    if (!root || !("valueType" in root)) return;
    let type = root.valueType;
    for (let index = 1; index <= path.length; index++) {
      const resolved = this.resolveStructType(type);
      if (!resolved) return;
      if (index === path.length) return resolved;
      const property = resolved.declaration.properties.find((declaration) => declaration.identifier === path[index]);
      if (!property) return;
      type = property.valueType;
    }
  }

  private resolveStructType(name: string): SemanticSymbol<StructDeclaration> | undefined {
    const found = this.structs.find((symbol) => symbol.declaration.identifier === name);
    const symbol = name === BuiltinType.vector ? this.getOrCreateSymbol(vectorType) : found ? this.getOrCreateSymbol(found.declaration, found.source) : undefined;
    return isSymbolOfKind(symbol, DeclarationKind.Struct) ? symbol : undefined;
  }

  private getOrCreateSymbol(declaration: Declaration, source?: SemanticInput, declarations: readonly Declaration[] = [declaration]): SemanticSymbol {
    const key = JSON.stringify([source?.uri, declaration.kind, declaration.identifier, declaration.kind === DeclarationKind.Function ? undefined : this.positionKey(declaration.position)]);
    let symbol = this.symbols.get(key);
    if (!symbol) {
      const workspace = this.workspace;
      const externalFunction = declaration.kind === DeclarationKind.Function && source !== this.inputs[0];
      symbol = {
        declaration,
        source,
        get declarations() {
          // Load external declaration sites only when navigation needs them.
          // Consult the live source each time so unsaved dependency edits remain visible.
          if (externalFunction && source?.owner) {
            const current = workspace.getFunctionDeclarations(source.owner).filter((candidate) => candidate.identifier === declaration.identifier);
            if (current.length) return current;
          }
          return declarations;
        },
      };
      this.symbols.set(key, symbol);
    }
    return symbol;
  }

  private positionKey(position: Position) {
    return `${position.line}:${position.character}`;
  }
}
