import { CompletionItemKind, Position } from "vscode-languageserver";
import { LanguageTypes } from "./constants";

type LanguageValueOrRef = string | number;

type LanguageConstant = {
  tokenType: typeof CompletionItemKind.Constant;
  valueType: LanguageTypes;
  value: LanguageValueOrRef;
  isConst?: true;
};
type LanguageVariable = {
  tokenType: typeof CompletionItemKind.Variable;
  valueType: LanguageTypes;
};
type LanguageFunction = {
  tokenType: typeof CompletionItemKind.Function;
  returnType: LanguageTypes;
  params: ParameterDeclaration[];
  variables?: VariableDeclaration[];
  implementation?: boolean;
  signatureEnd?: Position;
  comments: string[];
};
type LanguageFunctionParam = {
  tokenType: typeof CompletionItemKind.TypeParameter;
  valueType: LanguageTypes;
  defaultValue?: string;
};
type LanguageStruct = {
  tokenType: typeof CompletionItemKind.Struct;
  properties: FieldDeclaration[];
};
type LanguageStructProperty = {
  tokenType: typeof CompletionItemKind.Property;
  valueType: LanguageTypes;
};
type NamedDeclaration<T> = T & { position: Position; identifier: string };

export type ConstantDeclaration = NamedDeclaration<LanguageConstant>;
export type VariableDeclaration = NamedDeclaration<LanguageVariable>;
export type FunctionDeclaration = NamedDeclaration<LanguageFunction>;
export type ParameterDeclaration = NamedDeclaration<LanguageFunctionParam>;
export type StructDeclaration = NamedDeclaration<LanguageStruct>;
export type FieldDeclaration = NamedDeclaration<LanguageStructProperty>;
export type MemberReference = NamedDeclaration<{ tokenType: typeof CompletionItemKind.Reference; targetKind?: "struct" }>;

export type Declaration = ConstantDeclaration | VariableDeclaration | ParameterDeclaration | FunctionDeclaration | StructDeclaration | FieldDeclaration | MemberReference;
