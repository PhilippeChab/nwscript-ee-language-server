import { join } from "path";
import { Registry, INITIAL, parseRawGrammar, IToken } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { CompletionItemKind, CompletionItemTag, Position } from "vscode-languageserver";
import type { IGrammar } from "vscode-textmate";

import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { Logger } from "../Logger";
import {
  LanguageTypes,
  TYPE_SCOPE,
  BLOCK_TERMINATION_SCOPE,
  BLOCK_DECLARACTION_SCOPE,
  VARIABLE_SCOPE,
  INCLUDE_SCOPE,
  CONSTANT_DECLARATION_SCOPE,
  FUNCTION_SCOPE,
  BLOCK_SCOPE,
  FUNCTION_DECLARACTION_SCOPE,
  TERMINATOR_STATEMENT,
  STRUCT_SCOPE,
  FUNCTION_PARAMETER_SCOPE,
} from "./constants";
import type { ComplexToken, StructComplexToken } from "./types";

const wasmBin = WorkspaceFilesSystem.readFileSync(join(__dirname, "..", "..", "resources", "onig.wasm")).buffer;

const vscodeOnigurumaLib = loadWASM(wasmBin).then(() => {
  return {
    createOnigScanner(patterns: string[]) {
      return new OnigScanner(patterns);
    },
    createOnigString(string: string) {
      return new OnigString(string);
    },
  };
});

export enum TokenizedScope {
  global = "global",
  local = "local",
}

type GlobalScopeTokenizationResult = {
  complexTokens: ComplexToken[];
  structComplexTokens: StructComplexToken[];
  children: string[];
};

type LocalScopeTokenizationResult = {
  complexTokens: ComplexToken[];
  structTypeLineCandidates: number[];
};

export default class Tokenizer {
  private readonly registry: Registry;
  private grammar: IGrammar | null = null;

  constructor(private readonly logger: Logger | null = null) {
    this.registry = new Registry({
      onigLib: vscodeOnigurumaLib,
      loadGrammar: (scopeName) => {
        return new Promise((resolve, reject) => {
          if (scopeName === "source.nss") {
            return WorkspaceFilesSystem.readFileAsync(
              join(__dirname, "..", "..", "..", "syntaxes", "new.nwscript.tmLanguage")
            ).then((data) => resolve(parseRawGrammar((data as Buffer).toString())));
          }

          reject(`Unknown scope name: ${scopeName}`);
        });
      },
    });
  }

  private getRawTokenContent(line: string, token: IToken) {
    return line.slice(token.startIndex, token.endIndex);
  }

  private getTokenIndex(tokensArray: IToken[], targetToken: IToken) {
    return tokensArray.findIndex((token) => token.startIndex === targetToken.startIndex);
  }

  private getTokenLanguageType(line: string, token: IToken) {
    return (
      LanguageTypes[this.getRawTokenContent(line, token) as keyof typeof LanguageTypes] || this.getRawTokenContent(line, token)
    );
  }

  private getUniqueTokenLanguageType(line: string, tokensArray: IToken[]) {
    const token = tokensArray.find((token) => token.scopes.includes(STRUCT_SCOPE) || token.scopes.includes(TYPE_SCOPE));

    if (!token) {
      return LanguageTypes.none;
    }

    return this.getTokenLanguageType(line, token);
  }

  private getTokensLineVariable(line: string, tokensArray: IToken[]) {
    const token = tokensArray.find((token) => token.scopes.includes(VARIABLE_SCOPE));

    if (!token) {
      return "";
    }

    return this.getRawTokenContent(line, token);
  }

  private getFunctionParams(line: string, tokensArray: IToken[]) {
    const functionParamTokens = tokensArray.filter((token) => token.scopes.includes(FUNCTION_PARAMETER_SCOPE));

    return functionParamTokens.map((token) => {
      return {
        identifier: this.getRawTokenContent(line, token),
        tokenType: CompletionItemKind.TypeParameter,
        paramType: this.getTokenLanguageType(line, tokensArray[this.getTokenIndex(tokensArray, token) - 2]),
      };
    });
  }

  private tokenizeLinesForGlobalScope(lines: string[], startIndex: number = 0, stopIndex: number = -1) {
    const lastIndex = stopIndex > lines.length || stopIndex === -1 ? lines.length : stopIndex;
    const scope: GlobalScopeTokenizationResult = {
      complexTokens: [],
      structComplexTokens: [],
      children: [],
    };

    let ruleStack = INITIAL;
    let currentStruct: StructComplexToken | null = null;
    for (let currentIndex = startIndex; currentIndex < lastIndex; currentIndex++) {
      const line = lines[currentIndex];
      const tokensLine = this.grammar?.tokenizeLine(line, ruleStack);
      const tokensArray = tokensLine?.tokens;

      if (tokensLine && tokensArray) {
        ruleStack = tokensLine.ruleStack;

        const lastIndex = tokensArray.length - 1;
        const lastToken = tokensArray[lastIndex];
        for (let index = 0; index < tokensArray.length; index++) {
          const token = tokensArray[index];

          // STRUCT PROPERTIES
          if (currentStruct) {
            if (token.scopes.includes(BLOCK_TERMINATION_SCOPE)) {
              scope.structComplexTokens.push(currentStruct);
              currentStruct = null;
            } else if (!token.scopes.includes(BLOCK_DECLARACTION_SCOPE)) {
              currentStruct.data.properties.push({
                identifier: this.getTokensLineVariable(line, tokensArray),
                tokenType: CompletionItemKind.Property,
                propertyType: this.getUniqueTokenLanguageType(line, tokensArray),
              });
            }

            break;
          }

          // CHILD
          {
            if (token.scopes.includes(INCLUDE_SCOPE)) {
              scope.children.push(this.getRawTokenContent(line, tokensArray.at(-2)!));
              break;
            }
          }

          // CONSTANT
          if (
            token.scopes.includes(CONSTANT_DECLARATION_SCOPE) &&
            !token.scopes.includes(FUNCTION_SCOPE) &&
            !token.scopes.includes(BLOCK_SCOPE)
          ) {
            scope.complexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              data: {
                identifier: this.getRawTokenContent(line, token),
                tokenType: CompletionItemKind.Constant,
                valueType: this.getUniqueTokenLanguageType(line, tokensArray),
                value:
                  line
                    .split(" ")
                    .pop()
                    ?.slice(0, lastToken.scopes.includes(TERMINATOR_STATEMENT) ? -1 : 0) || "",
              },
            });
            break;
          }

          // FUNCTION
          if (
            token.scopes.includes(FUNCTION_DECLARACTION_SCOPE) &&
            lastToken.scopes.includes(TERMINATOR_STATEMENT) &&
            !token.scopes.includes(BLOCK_SCOPE)
          ) {
            scope.complexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              data: {
                identifier: this.getRawTokenContent(line, token),
                tokenType: CompletionItemKind.Function,
                returnType: this.getUniqueTokenLanguageType(line, tokensArray),
                params: this.getFunctionParams(line, tokensArray),
              },
            });
            break;
          }

          // STRUCT
          if (
            token.scopes.includes(STRUCT_SCOPE) &&
            (lastToken.scopes.includes(STRUCT_SCOPE) || lastToken.scopes.includes(BLOCK_DECLARACTION_SCOPE))
          ) {
            currentStruct = {
              position: { line: currentIndex, character: token.startIndex },
              data: {
                identifier: this.getRawTokenContent(line, token),
                tokenType: CompletionItemKind.Struct,
                properties: [],
              },
            };
            break;
          }
        }
      }
    }

    return scope;
  }

  private tokenizeLinesForLocalScope(lines: string[], startIndex: number = 0, stopIndex: number = -1) {
    const lastIndex = stopIndex > lines.length || stopIndex === -1 ? lines.length : stopIndex;
    const scope: LocalScopeTokenizationResult = {
      complexTokens: [],
      structTypeLineCandidates: [],
    };

    let ruleStack = INITIAL;

    return scope;
  }

  public tokenizeContent(
    content: string,
    scope: TokenizedScope.global,
    startIndex?: number,
    stopIndex?: number
  ): GlobalScopeTokenizationResult;
  public tokenizeContent(
    content: string,
    scope: TokenizedScope.local,
    startIndex?: number,
    stopIndex?: number
  ): LocalScopeTokenizationResult;
  public tokenizeContent(content: string, scope: TokenizedScope, startIndex: number = 0, stopIndex: number = -1) {
    if (scope === TokenizedScope.global) {
      return this.tokenizeLinesForGlobalScope(content.split(/\r?\n/), startIndex, stopIndex);
    } else {
      return this.tokenizeLinesForLocalScope(content.split(/\r?\n/), startIndex, stopIndex);
    }
  }

  // public retrieveStructType(content: string, position: Position) {
  //   const lines = content.split(/\r?\n/);

  //   const variableLine = lines[position.line];
  //   const variable = variableLine
  //     .slice(0, position.character - 1)
  //     .split(" ")
  //     .at(-1)
  //     ?.trim();

  //   let label;
  //   const tokensLines = this.tokenizeLinesForGlobalScope(lines, 0, position.line);

  //   for (let currentIndex = position.line - 1; currentIndex > 0; currentIndex--) {
  //     const tokens = tokensLines[currentIndex];
  //     const variableTypeTokenIndex = tokens.findIndex((token) => token.meta.scopes.includes(STRUCT_SCOPE));

  //     if (variableTypeTokenIndex !== -1 && tokens[variableTypeTokenIndex + 2].content === variable) {
  //       label = tokens[variableTypeTokenIndex].content;
  //       break;
  //     }
  //   }

  //   return label;
  // }

  // public isStructureCandidate(content: string, position: Position) {
  //   const lines = content.split(/\r?\n/);
  //   const tokensLine = this.tokenizeLine(lines, position.line);
  //   const currentTokenPosition = tokensLine.findIndex((token) => token.meta.endIndex === position.character);

  //   return currentTokenPosition >= 2 ? tokensLine[currentTokenPosition - 2].content === LanguageTypes.struct : false;
  // }

  public async loadGrammar() {
    this.grammar = await this.registry.loadGrammar("source.nss");

    return this;
  }
}
