/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

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
  variables?: VariableComplexToken[];
  comments: string[];
};
type LanguageFunctionParam = {
  tokenType: typeof CompletionItemKind.TypeParameter;
  valueType: LanguageTypes;
  defaultValue?: string;
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
