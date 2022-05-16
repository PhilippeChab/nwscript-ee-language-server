import { CompletionItemKind } from "vscode-languageserver";
import { LanguageTypes } from "../../Tokenizer/constants";
import type {
  ComplexToken,
  ConstantComplexToken,
  VariableComplexToken,
  FunctionParamComplexToken,
  FunctionComplexToken,
  StructPropertyComplexToken,
  StructComplexToken,
} from "../../Tokenizer/types";

export default abstract class Builder {
  protected static handleLanguageType(type: string) {
    if (!(type in LanguageTypes)) {
      return `struct ${type}`;
    }

    return type;
  }

  protected static isConstantToken(token: ComplexToken): token is ConstantComplexToken {
    return token.tokenType === CompletionItemKind.Constant;
  }

  protected static isVariable(token: ComplexToken): token is VariableComplexToken {
    return token.tokenType === CompletionItemKind.Variable;
  }

  protected static isFunctionParameter(token: ComplexToken): token is FunctionParamComplexToken {
    return token.tokenType === CompletionItemKind.TypeParameter;
  }

  protected static isFunctionToken(token: ComplexToken): token is FunctionComplexToken {
    return token.tokenType === CompletionItemKind.Function;
  }

  protected static isStructPropertyToken(token: ComplexToken): token is StructPropertyComplexToken {
    return token.tokenType === CompletionItemKind.Property;
  }

  protected static isStructToken(token: ComplexToken): token is StructComplexToken {
    return token.tokenType === CompletionItemKind.Struct;
  }
}
