import { ParameterInformation, SignatureHelp, SignatureInformation } from "vscode-languageserver";
import type { ComplexToken, FunctionComplexToken } from "../../Tokenizer/types";
import Builder from "./Builder";

export default class SignatureHelpBuilder extends Builder {
  public static buildItem(token: ComplexToken, activeSignatureHelp: SignatureHelp | undefined): SignatureHelp | undefined {
    if (this.isFunctionToken(token)) {
      return this.buildFunctionItem(token, activeSignatureHelp);
    } else {
      return undefined;
    }
  }

  static buildFunctionItem(token: FunctionComplexToken, activeSignatureHelp: SignatureHelp | undefined) {
    return {
      signatures: [
        SignatureInformation.create(
          `${this.handleLanguageType(token.returnType)} ${token.identifier}(${token.params.reduce((acc, param, index) => {
            return `${acc}${this.handleLanguageType(param.valueType)} ${param.identifier}${
              index === token.params.length - 1 ? "" : ", "
            }`;
          }, "")})`,
          undefined,
          ...(token as FunctionComplexToken).params.map<ParameterInformation>((param) =>
            ParameterInformation.create(`${param.valueType} ${param.identifier}`)
          )
        ),
      ],
      activeSignature: activeSignatureHelp?.activeSignature || null,
      activeParameter: activeSignatureHelp?.activeParameter || null,
    };
  }
}
