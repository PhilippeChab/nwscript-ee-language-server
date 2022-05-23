import { CompletionItemKind, Position } from "vscode-languageserver";
import { LanguageTypes } from "./constants";

type LanguageValueOrRef = string | number;

type LanguageConstant = {
  tokenType: typeof CompletionItemKind.Constant;
  valueType: LanguageTypes;
  value: LanguageValueOrRef;
};
type LanguageVariable = {
  tokenType: typeof CompletionItemKind.Variable;
  valueType: LanguageTypes;
};
type LanguageFunction = {
  tokenType: typeof CompletionItemKind.Function;
  returnType: LanguageTypes;
  params: FunctionParamComplexToken[];
  comments: string[];
};
type LanguageFunctionParam = {
  tokenType: typeof CompletionItemKind.TypeParameter;
  valueType: LanguageTypes;
};
type LanguageStruct = {
  tokenType: typeof CompletionItemKind.Struct;
  properties: StructPropertyComplexToken[];
};
type LanguageStructProperty = {
  tokenType: typeof CompletionItemKind.Property;
  valueType: LanguageTypes;
};
type BaseComplexToken<T> = T & { position: Position; identifier: string };

export type ConstantComplexToken = BaseComplexToken<LanguageConstant>;
export type VariableComplexToken = BaseComplexToken<LanguageVariable>;
export type FunctionComplexToken = BaseComplexToken<LanguageFunction>;
export type FunctionParamComplexToken = BaseComplexToken<LanguageFunctionParam>;
export type StructComplexToken = BaseComplexToken<LanguageStruct>;
export type StructPropertyComplexToken = BaseComplexToken<LanguageStructProperty>;

export type ComplexToken =
  | ConstantComplexToken
  | VariableComplexToken
  | FunctionParamComplexToken
  | FunctionComplexToken
  | StructComplexToken
  | StructPropertyComplexToken;
