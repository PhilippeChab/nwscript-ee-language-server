import type { Position, Range } from "vscode-languageserver";
import type { FunctionDeclaration, VariableDeclaration, ParameterDeclaration } from "./Declarations";
import type { ReferenceKind } from "./References";

export type LocalScope = {
  functionDeclarations: FunctionDeclaration[];
  variableDeclarations: (VariableDeclaration | ParameterDeclaration)[];
};

export type CallContext = { identifier: string; activeParameter: number };
export type SyntaxTarget = { identifier: string; range: Range; kind?: ReferenceKind };

export type AutoImportContext = {
  prefix: string;
  replacementRange: Range;
  insertionPosition: Position;
  structsOnly: boolean;
};
