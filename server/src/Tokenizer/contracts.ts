import type { Position, Range } from "vscode-languageserver";
import type { ComplexToken, StructComplexToken, FunctionComplexToken, VariableComplexToken, FunctionParamComplexToken, MemberReferenceComplexToken } from "./types";

export enum TokenizationMode {
  document = "document",
  local = "local",
}

// The document index includes import-conflict metadata. Only globalDeclarations
// and structDeclarations provide globally visible symbols; indexed locals retain
// their original scope and member references are not resolved symbols.
export type DocumentTokenizationResult = {
  globalDeclarations: ComplexToken[];
  structDeclarations: StructComplexToken[];
  children: string[];
  includePositions?: Position[];
  entryPointDeclarations?: FunctionComplexToken[];
  localDeclarations?: (VariableComplexToken | FunctionParamComplexToken)[];
  memberReferences?: MemberReferenceComplexToken[];
};

export type LocalScopeTokenizationResult = {
  functionsComplexTokens: FunctionComplexToken[];
  functionVariablesComplexTokens: (VariableComplexToken | FunctionParamComplexToken)[];
};

export type AutoImportContext = {
  prefix: string;
  replacementRange: Range;
  insertionPosition: Position;
  structsOnly: boolean;
};
