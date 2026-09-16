import type { Position } from "vscode-languageserver";
import { LanguageTypes } from "./constants";

// Internal syntax/index classifications, independent of editor protocol enums.
export enum DeclarationKind {
  Constant = "constant",
  Variable = "variable",
  Function = "function",
  Parameter = "parameter",
  Struct = "struct",
  Field = "field",
}

export enum ReferenceKind {
  Member = "memberReference",
  Type = "typeReference",
}

type LanguageValueOrRef = string | number;

type LanguageConstant = {
  kind: DeclarationKind.Constant;
  valueType: LanguageTypes;
  value: LanguageValueOrRef;
  // Records the source qualifier; implicit nwscript.nss constants omit it.
  isConst?: true;
};
type LanguageVariable = {
  kind: DeclarationKind.Variable;
  scope: "global" | "local";
  valueType: LanguageTypes;
  value?: LanguageValueOrRef;
};
type LanguageFunction = {
  kind: DeclarationKind.Function;
  returnType: LanguageTypes;
  params: ParameterDeclaration[];
  variables?: VariableDeclaration[];
  implementation?: boolean;
  signatureEnd?: Position;
  comments: string[];
};
type LanguageFunctionParam = {
  kind: DeclarationKind.Parameter;
  valueType: LanguageTypes;
  defaultValue?: string;
};
type LanguageStruct = {
  kind: DeclarationKind.Struct;
  properties: FieldDeclaration[];
};
type LanguageStructProperty = {
  kind: DeclarationKind.Field;
  valueType: LanguageTypes;
};
type NamedLocation<T> = T & { position: Position; identifier: string };

export type ConstantDeclaration = NamedLocation<LanguageConstant>;
export type VariableDeclaration = NamedLocation<LanguageVariable>;
export type FunctionDeclaration = NamedLocation<LanguageFunction>;
export type ParameterDeclaration = NamedLocation<LanguageFunctionParam>;
export type StructDeclaration = NamedLocation<LanguageStruct>;
export type FieldDeclaration = NamedLocation<LanguageStructProperty>;
export type MemberReference = NamedLocation<{ kind: ReferenceKind.Member }>;
export type TypeReference = NamedLocation<{ kind: ReferenceKind.Type }>;

export type Declaration = ConstantDeclaration | VariableDeclaration | ParameterDeclaration | FunctionDeclaration | StructDeclaration | FieldDeclaration;

// Import checks order both declarations and uses by their source locations.
export type IndexedName = Declaration | MemberReference | TypeReference;
