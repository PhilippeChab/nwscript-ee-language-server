import { CompletionItemKind, Position } from "vscode-languageserver";
import { LanguageTypes } from "./constants";

type LanguageValueOrRef = string | number;

type LanguageConstant = {
  kind: typeof CompletionItemKind.Constant;
  valueType: LanguageTypes;
  value: LanguageValueOrRef;
  isConst?: true;
};
type LanguageVariable = {
  kind: typeof CompletionItemKind.Variable;
  valueType: LanguageTypes;
};
type LanguageFunction = {
  kind: typeof CompletionItemKind.Function;
  returnType: LanguageTypes;
  params: ParameterDeclaration[];
  variables?: VariableDeclaration[];
  implementation?: boolean;
  signatureEnd?: Position;
  comments: string[];
};
type LanguageFunctionParam = {
  kind: typeof CompletionItemKind.TypeParameter;
  valueType: LanguageTypes;
  defaultValue?: string;
};
type LanguageStruct = {
  kind: typeof CompletionItemKind.Struct;
  properties: FieldDeclaration[];
};
type LanguageStructProperty = {
  kind: typeof CompletionItemKind.Property;
  valueType: LanguageTypes;
};
type NamedLocation<T> = T & { position: Position; identifier: string };

export type ConstantDeclaration = NamedLocation<LanguageConstant>;
export type VariableDeclaration = NamedLocation<LanguageVariable>;
export type FunctionDeclaration = NamedLocation<LanguageFunction>;
export type ParameterDeclaration = NamedLocation<LanguageFunctionParam>;
export type StructDeclaration = NamedLocation<LanguageStruct>;
export type FieldDeclaration = NamedLocation<LanguageStructProperty>;
export type MemberReference = NamedLocation<{ kind: typeof CompletionItemKind.Reference; targetKind?: never }>;
export type TypeReference = NamedLocation<{ kind: typeof CompletionItemKind.Reference; targetKind: "struct" }>;

export type Declaration = ConstantDeclaration | VariableDeclaration | ParameterDeclaration | FunctionDeclaration | StructDeclaration | FieldDeclaration;

// Import checks order both declarations and uses by their source locations.
export type IndexedName = Declaration | MemberReference | TypeReference;
