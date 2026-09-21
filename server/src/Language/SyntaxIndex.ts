import type { Position } from "vscode-languageserver";
import type { Declaration, GlobalDeclaration, StructDeclaration, FunctionDeclaration, VariableDeclaration, ParameterDeclaration } from "./Declarations";
import type { MemberReference, TypeReference } from "./References";

// Serializable data extracted from Syntax, including metadata for import checks.
// Locals and references retain their original meaning; they are not global symbols.
export type SyntaxIndex = {
  globalDeclarations: GlobalDeclaration[];
  structDeclarations: StructDeclaration[];
  includes: { name: string; position?: Position }[];
  entryPointDeclarations?: FunctionDeclaration[];
  localDeclarations?: (VariableDeclaration | ParameterDeclaration)[];
  memberReferences?: MemberReference[];
};

// Import checks order both declarations and uses by their source locations.
export type IndexedName = Declaration | MemberReference | TypeReference;
export type StandardLibraryDefinitions = SyntaxIndex & { owner?: string };
