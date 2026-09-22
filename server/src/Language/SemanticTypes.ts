import type { Position, Range } from "vscode-languageserver";
import type { Declaration, FunctionDeclaration } from "./Declarations";
import { DeclarationKind } from "./Declarations";
import type { SyntaxIndex } from "./SyntaxIndex";
import type { AutoImportContext } from "./SyntaxTypes";

export type SemanticInput = { uri: string; owner?: string; index: SyntaxIndex };
export type SourcedDeclaration = { declaration: Declaration; source: SemanticInput };

// Symbols share identity within one semantic snapshot. The representative
// declaration supplies display metadata; declarations preserves the source sites.
export type SemanticSymbol<D extends Declaration = Declaration> = {
  readonly declaration: D;
  readonly source?: SemanticInput;
  readonly declarations: readonly D[];
};

export type SymbolBinding = { readonly range: Range; readonly symbol?: SemanticSymbol };
export type ImportCandidate = { declaration: Declaration; includeName: string };
export type SemanticWorkspace = {
  getImportCandidates: (context: AutoImportContext, visibleNames: Set<string>, limit: number) => ImportCandidate[];
  getFunctionDeclarations: (uri: string) => FunctionDeclaration[];
};
export type CompletionContext = { symbols: SemanticSymbol[]; imports: ImportCandidate[]; autoImportContext?: AutoImportContext };
export type ResolvedCall = { symbol: SemanticSymbol<FunctionDeclaration>; activeParameter: number };
export type DefinitionTarget = { uri: string; position: Position };

export function isSymbolOfKind<K extends DeclarationKind>(symbol: SemanticSymbol | undefined, kind: K): symbol is SemanticSymbol<Extract<Declaration, { kind: K }>> {
  return symbol?.declaration.kind === kind;
}
