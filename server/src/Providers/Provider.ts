import { CompletionItemKind, Position } from "vscode-languageserver";
import type { Declaration, StructDeclaration } from "../Parser/types";
import { LanguageTypes } from "../Parser/constants";
import type { ServerManager } from "../ServerManager";

// Vector fields are built into NWScript and have no source document.
const vectorType: StructDeclaration = {
  identifier: LanguageTypes.vector,
  kind: CompletionItemKind.Struct,
  position: Position.create(0, 0),
  properties: ["x", "y", "z"].map((identifier) => ({ identifier, valueType: LanguageTypes.float, kind: CompletionItemKind.Property, position: Position.create(0, 0) })),
};

export default class Provider {
  constructor(protected readonly server: ServerManager) {}

  public static register(server: ServerManager) {
    return new this(server);
  }

  protected getDocumentContext(uri: string, position?: Position) {
    const liveDocument = this.server.liveDocumentsManager.get(uri);
    if (!liveDocument) return;
    const document = this.server.documentsCollection.getParsedDocument(liveDocument, this.server.parserService);
    const { syntax } = document;
    if (!syntax) return;
    return {
      liveDocument,
      document,
      localScope: syntax.getLocalScope(position),
    };
  }

  protected resolveValue(context: NonNullable<ReturnType<Provider["getDocumentContext"]>>, name: string | undefined): { declaration: Declaration; owner?: string } | undefined {
    const { document, localScope, liveDocument } = context;
    const local = localScope.variableDeclarations.find((declaration) => declaration.identifier === name);
    if (local) return { declaration: local, owner: liveDocument.uri };
    const library = this.server.standardLibrary.get(liveDocument.uri);
    for (const { owner, declarations } of [...document.getGlobalDeclarationsWithOwner(), { owner: library.owner, declarations: library.globalDeclarations }]) {
      const declaration = declarations.find((candidate) => candidate.identifier === name);
      if (declaration) return { declaration, owner };
    }
    const fn = localScope.functionDeclarations.find((declaration) => declaration.identifier === name);
    if (fn) return { declaration: fn, owner: liveDocument.uri };
  }

  protected resolveMemberStruct(context: NonNullable<ReturnType<Provider["getDocumentContext"]>>, path: string[]) {
    const root = this.resolveValue(context, path[0])?.declaration;
    if (!root || !("valueType" in root)) return;
    let type = root.valueType;
    for (let index = 1; index <= path.length; index++) {
      const resolved = this.resolveStructType(context, type);
      if (!resolved) return;
      if (index === path.length) return resolved;
      const property = resolved.declaration.properties.find((declaration) => declaration.identifier === path[index]);
      if (!property) return;
      type = property.valueType;
    }
  }

  protected resolveSymbol(uri: string, position: Position): { declaration: Declaration; owner?: string } | undefined {
    const context = this.getDocumentContext(uri, position);
    if (!context) return;
    const { syntax } = context.document;
    if (!syntax) return;
    const memberPath = syntax.getMemberPath(position);
    if (memberPath) {
      const struct = this.resolveMemberStruct(context, memberPath.slice(0, -1));
      const declaration = struct?.declaration.properties.find((property) => property.identifier === memberPath[memberPath.length - 1]);
      return declaration ? { declaration, owner: struct?.owner } : undefined;
    }
    const { kind, rawContent } = syntax.getActionTarget(position);
    const fieldDeclaration = context.document.structDeclarations
      .flatMap((struct) => struct.properties)
      .find(
        (field) =>
          field.identifier === rawContent &&
          field.position.line === position.line &&
          position.character >= field.position.character &&
          position.character <= field.position.character + field.identifier.length,
      );
    if (fieldDeclaration) return { declaration: fieldDeclaration, owner: context.liveDocument.uri };
    // An unrecognized receiver must not turn a member into an ordinary name.
    if (kind === CompletionItemKind.Property) return;
    if (kind === CompletionItemKind.Struct && rawContent) return this.resolveStructType(context, rawContent);
    return this.resolveValue(context, rawContent);
  }

  protected getStandardLibDeclarations(uri: string) {
    return this.server.standardLibrary.get(uri).globalDeclarations;
  }

  protected getStandardLibStructDeclarations(uri: string) {
    return this.server.standardLibrary.get(uri).structDeclarations;
  }

  protected exceptionsWrapper<N>(cb: () => N): N | undefined;
  protected exceptionsWrapper<N>(cb: () => N, defaultResult: N): N;
  protected exceptionsWrapper<N>(cb: () => N, defaultResult?: N): N | undefined {
    let result;
    try {
      result = cb();
    } catch (e: any) {
      this.reportError(e);
    }
    return result || defaultResult;
  }

  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>): Promise<N | undefined>;
  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>, defaultResult: N): Promise<N>;
  protected async asyncExceptionsWrapper<N>(cb: () => Promise<N>, defaultResult?: N): Promise<N | undefined> {
    let result;
    try {
      result = await cb();
    } catch (e: any) {
      this.reportError(e);
    }
    return result || defaultResult;
  }

  private resolveStructType(context: NonNullable<ReturnType<Provider["getDocumentContext"]>>, name: string): { declaration: StructDeclaration; owner?: string } | undefined {
    if (name === LanguageTypes.vector) return { declaration: vectorType };
    const library = this.server.standardLibrary.get(context.liveDocument.uri);
    for (const { owner, declarations } of [...context.document.getStructDeclarationsWithOwner(), { owner: library.owner, declarations: library.structDeclarations }]) {
      const declaration = declarations.find((candidate) => candidate.identifier === name);
      if (declaration) return { declaration, owner };
    }
  }

  private reportError(error: unknown) {
    this.server.logger.error(`Could not resolve request: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}
