import type { Position } from "vscode-languageserver";
import type { TypeName } from "./TypeNames";

export enum DeclarationKind {
  Constant = "constant",
  Variable = "variable",
  Function = "function",
  Parameter = "parameter",
  Struct = "struct",
  Field = "field",
}

export type NamedLocation = { position: Position; identifier: string };

export type ConstantDeclaration = NamedLocation & {
  kind: DeclarationKind.Constant;
  valueType: TypeName;
  value: string | number;
  // Records the source qualifier; implicit nwscript.nss constants omit it.
  isConst?: true;
};

export type VariableDeclaration = NamedLocation & {
  kind: DeclarationKind.Variable;
  scope: "global" | "local";
  valueType: TypeName;
  value?: string | number;
};

export type FunctionDeclaration = NamedLocation & {
  kind: DeclarationKind.Function;
  returnType: TypeName;
  params: ParameterDeclaration[];
  variables?: VariableDeclaration[];
  implementation?: boolean;
  signatureEnd?: Position;
  comments: string[];
};

export type ParameterDeclaration = NamedLocation & {
  kind: DeclarationKind.Parameter;
  valueType: TypeName;
  defaultValue?: string;
};

export type StructDeclaration = NamedLocation & {
  kind: DeclarationKind.Struct;
  properties: FieldDeclaration[];
};

export type FieldDeclaration = NamedLocation & {
  kind: DeclarationKind.Field;
  valueType: TypeName;
};

export type Declaration = ConstantDeclaration | VariableDeclaration | ParameterDeclaration | FunctionDeclaration | StructDeclaration | FieldDeclaration;
export type GlobalDeclaration = ConstantDeclaration | FunctionDeclaration | (VariableDeclaration & { scope: "global" });
