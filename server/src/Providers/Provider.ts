import { CompletionItemKind, Position } from "vscode-languageserver";
import type { ComplexToken, StructComplexToken } from "../Tokenizer/types";
import { LanguageTypes } from "../Tokenizer/constants";
import type { ServerManager } from "../ServerManager";

// Vector fields are built into NWScript and have no source document.
const vectorType: StructComplexToken = {
  identifier: LanguageTypes.vector,
  tokenType: CompletionItemKind.Struct,
  position: Position.create(0, 0),
  properties: ["x", "y", "z"].map((identifier) => ({ identifier, valueType: LanguageTypes.float, tokenType: CompletionItemKind.Property, position: Position.create(0, 0) })),
};

export default class Provider {
  constructor(protected readonly server: ServerManager) {}

  public static register(server: ServerManager) {
    return new this(server);
  }

  protected getDocumentContext(uri: string, position?: Position) {
    const liveDocument = this.server.liveDocumentsManager.get(uri);
    if (!liveDocument) return;
    const [lines, rawTokenizedContent] = this.server.tokenizer.tokenizeContentToRaw(liveDocument.getText());
    return {
      liveDocument,
      lines,
      rawTokenizedContent,
      document: this.server.documentsCollection.initializeDocument(uri, false, this.server.tokenizer.tokenizeDocumentFromRaw(lines, rawTokenizedContent)),
      localScope: this.server.tokenizer.tokenizeContentFromRaw(lines, rawTokenizedContent, 0, position?.line, position?.character),
    };
  }

  protected resolveValue(context: NonNullable<ReturnType<Provider["getDocumentContext"]>>, name: string | undefined): { token: ComplexToken; owner?: string } | undefined {
    const { document, localScope, liveDocument } = context;
    const local = localScope.functionVariablesComplexTokens.find((token) => token.identifier === name);
    if (local) return { token: local, owner: liveDocument.uri };
    const library = this.server.standardLibrary.get(liveDocument.uri);
    for (const { owner, tokens } of [...document.getGlobalComplexTokensWithRef(), { owner: library.owner, tokens: library.globalDeclarations }]) {
      const token = tokens.find((candidate) => candidate.identifier === name);
      if (token) return { token, owner };
    }
    const fn = localScope.functionsComplexTokens.find((token) => token.identifier === name);
    if (fn) return { token: fn, owner: liveDocument.uri };
  }

  protected resolveMemberStruct(context: NonNullable<ReturnType<Provider["getDocumentContext"]>>, path: string[]) {
    const root = this.resolveValue(context, path[0])?.token;
    if (!root || !("valueType" in root)) return;
    let type = root.valueType;
    for (let index = 1; index <= path.length; index++) {
      const resolved = this.resolveStructType(context, type);
      if (!resolved) return;
      if (index === path.length) return resolved;
      const property = resolved.token.properties.find((token) => token.identifier === path[index]);
      if (!property) return;
      type = property.valueType;
    }
  }

  protected resolveSymbol(uri: string, position: Position): { token: ComplexToken; owner?: string } | undefined {
    const context = this.getDocumentContext(uri, position);
    if (!context) return;
    const { lines, rawTokenizedContent } = context;
    const memberPath = this.server.tokenizer.getMemberAccessFromRaw(lines, rawTokenizedContent, position);
    if (memberPath) {
      const struct = this.resolveMemberStruct(context, memberPath.slice(0, -1));
      const token = struct?.token.properties.find((property) => property.identifier === memberPath[memberPath.length - 1]);
      return token ? { token, owner: struct?.owner } : undefined;
    }
    const { tokenType, rawContent } = this.server.tokenizer.getActionTargetAtPosition(lines, rawTokenizedContent, position);
    const fieldDeclaration = context.document.structDeclarations
      .flatMap((struct) => struct.properties)
      .find(
        (field) =>
          field.identifier === rawContent &&
          field.position.line === position.line &&
          position.character >= field.position.character &&
          position.character <= field.position.character + field.identifier.length,
      );
    if (fieldDeclaration) return { token: fieldDeclaration, owner: context.liveDocument.uri };
    // An unrecognized receiver must not turn a member into an ordinary name.
    if (tokenType === CompletionItemKind.Property) return;
    if (tokenType === CompletionItemKind.Struct && rawContent) return this.resolveStructType(context, rawContent);
    return this.resolveValue(context, rawContent);
  }

  protected getStandardLibComplexTokens(uri: string) {
    return this.server.standardLibrary.get(uri).globalDeclarations;
  }

  protected getStandardLibStructTokens(uri: string) {
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

  private resolveStructType(context: NonNullable<ReturnType<Provider["getDocumentContext"]>>, name: string): { token: StructComplexToken; owner?: string } | undefined {
    if (name === LanguageTypes.vector) return { token: vectorType };
    const library = this.server.standardLibrary.get(context.liveDocument.uri);
    for (const { owner, tokens } of [...context.document.getGlobalStructComplexTokensWithRef(), { owner: library.owner, tokens: library.structDeclarations }]) {
      const token = tokens.find((candidate) => candidate.identifier === name);
      if (token) return { token, owner };
    }
  }

  private reportError(error: unknown) {
    this.server.logger.error(`Could not resolve request: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}
