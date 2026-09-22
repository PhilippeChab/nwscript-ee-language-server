import { ParameterInformation, SignatureInformation } from "vscode-languageserver";
import type { SignatureHelp } from "vscode-languageserver";

import type { FunctionDeclaration } from "../../Language";
import Builder from "./Builder";

export default class SignatureHelpBuilder extends Builder {
  static buildFunctionItem(declaration: FunctionDeclaration, activeParameter: number | undefined): SignatureHelp {
    const parameters = declaration.params.map((param) => this.formatParameter(param));
    return {
      signatures: [
        SignatureInformation.create(
          `${this.handleLanguageType(declaration.returnType)} ${declaration.identifier}(${parameters.join(", ")})`,
          undefined,
          ...parameters.map<ParameterInformation>((label) => ParameterInformation.create(label)),
        ),
      ],
      activeSignature: 0,
      activeParameter,
    };
  }
}
