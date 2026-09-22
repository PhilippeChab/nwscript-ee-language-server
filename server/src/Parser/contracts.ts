import type { Position, Range } from "vscode-languageserver";
import type { Declaration, StructDeclaration, FunctionDeclaration, VariableDeclaration, ParameterDeclaration, MemberReference } from "./types";

export enum AnalysisMode {
  document = "document",
  local = "local",
}

// The document index includes import-conflict metadata. Only globalDeclarations
// and structDeclarations provide globally visible symbols; indexed locals retain
// their original scope and member references are not resolved symbols.
export type DocumentIndex = {
  globalDeclarations: Declaration[];
  structDeclarations: StructDeclaration[];
  includes: { name: string; position?: Position }[];
  entryPointDeclarations?: FunctionDeclaration[];
  localDeclarations?: (VariableDeclaration | ParameterDeclaration)[];
  memberReferences?: MemberReference[];
};

export type LocalScope = {
  functionDeclarations: FunctionDeclaration[];
  variableDeclarations: (VariableDeclaration | ParameterDeclaration)[];
};

export type AutoImportContext = {
  prefix: string;
  replacementRange: Range;
  insertionPosition: Position;
  structsOnly: boolean;
};
