import { ParameterInformation, SignatureInformation } from "vscode-languageserver";
import type { SignatureHelp } from "vscode-languageserver";

import type { FunctionComplexToken } from "../../Tokenizer/types";
import Builder from "./Builder";

export default class SignatureHelpBuilder extends Builder {
  static buildFunctionItem(token: FunctionComplexToken, activeParameter: number | undefined): SignatureHelp {
    const parameters = token.params.map((param) => this.formatParameter(param));
    return {
      signatures: [
        SignatureInformation.create(
          `${this.handleLanguageType(token.returnType)} ${token.identifier}(${parameters.join(", ")})`,
          undefined,
          ...parameters.map<ParameterInformation>((label) => ParameterInformation.create(label)),
        ),
      ],
      activeSignature: 0,
      activeParameter,
    };
  }
}
