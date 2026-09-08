/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

import { ParameterInformation, SignatureInformation } from "vscode-languageserver";
import type { SignatureHelp } from "vscode-languageserver";

import type { FunctionComplexToken } from "../../Tokenizer/types";
import Builder from "./Builder";

export default class SignatureHelpBuilder extends Builder {
  static buildFunctionItem(token: FunctionComplexToken, activeParameter: number | undefined): SignatureHelp {
    return {
      signatures: [
        SignatureInformation.create(
          `${this.handleLanguageType(token.returnType)} ${token.identifier}(${token.params.reduce((acc, param, index) => {
            return `${acc}${this.handleLanguageType(param.valueType)} ${param.identifier}${
              index === token.params.length - 1 ? "" : ", "
            }`;
          }, "")})`,
          undefined,
          ...token.params.map<ParameterInformation>((param) =>
            ParameterInformation.create(`${param.valueType} ${param.identifier}`),
          ),
        ),
      ],
      activeSignature: 0,
      activeParameter,
    };
  }
}
