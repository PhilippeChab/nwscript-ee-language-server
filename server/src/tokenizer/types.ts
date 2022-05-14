import { CompletionItemKind, Position } from "vscode-languageserver";
import { LanguageTypes } from "./constants";

export type LanguageValueOrRef = string | number;

export type LanguageParam = {
  identifier: string;
  tokenType: typeof CompletionItemKind.TypeParameter;
  paramType: LanguageTypes;
};
export type LangugeFunction = {
  identifier: string;
  tokenType: typeof CompletionItemKind.Function;
  returnType: LanguageTypes;
  params: LanguageParam[];
};
export type LanguageVariable = {
  identifier: string;
  tokenType: typeof CompletionItemKind.Variable;
  valueType: LanguageTypes;
  value: LanguageValueOrRef;
};
export type LanguageConstant = {
  identifier: string;
  tokenType: typeof CompletionItemKind.Constant;
  valueType: LanguageTypes;
  value: LanguageValueOrRef;
};
export type LanguageStructProperty = {
  identifier: string;
  tokenType: typeof CompletionItemKind.Property;
  propertyType: LanguageTypes;
};
export type LanguageStruct = {
  identifier: string;
  tokenType: typeof CompletionItemKind.Struct;
  properties: LanguageStructProperty[];
};

export interface BaseComplexToken {
  position: Position;
}
export interface ConstantComplexToken extends BaseComplexToken {
  data: LanguageConstant;
}
export interface FunctionComplexToken extends BaseComplexToken {
  data: LangugeFunction;
}
export interface StructComplexToken extends BaseComplexToken {
  data: LanguageStruct;
}

export type ComplexToken = ConstantComplexToken | FunctionComplexToken | StructComplexToken;
