import { join } from "path";
import { Registry, INITIAL, parseRawGrammar, IToken } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { CompletionItemKind } from "vscode-languageserver";
import type { IGrammar } from "vscode-textmate";

import { TriggerCharacters } from "../Providers";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { Logger } from "../Logger";
import {
  LanguageTypes,
  TYPE_SCOPE,
  BLOCK_TERMINATION_SCOPE,
  BLOCK_DECLARACTION_SCOPE,
  VARIABLE_SCOPE,
  INCLUDE_SCOPE,
  CONSTANT_SCOPE,
  FUNCTION_SCOPE,
  BLOCK_SCOPE,
  FUNCTION_DECLARACTION_SCOPE,
  TERMINATOR_STATEMENT,
  STRUCT_SCOPE,
  FUNCTION_PARAMETER_SCOPE,
  ASSIGNATION_STATEMENT,
} from "./constants";
import type {
  ComplexToken,
  FunctionComplexToken,
  FunctionParamComplexToken,
  StructComplexToken,
  VariableComplexToken,
} from "./types";
import { Position } from "vscode-languageserver-textdocument";
import { map } from "async";

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

export type GlobalScopeTokenizationResult = {
  complexTokens: ComplexToken[];
  structComplexTokens: StructComplexToken[];
  children: string[];
};

export type LocalScopeTokenizationResult = {
  functionsComplexTokens: FunctionComplexToken[];
  functionVariablesComplexTokens: (VariableComplexToken | FunctionParamComplexToken)[];
  structIdentifiersLineCandidate?: number;
  structPropertiesCandidate?: string;
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
    const rawContent = this.getRawTokenContent(line, token);

    return LanguageTypes[rawContent as keyof typeof LanguageTypes] || rawContent;
  }

  private getConstantValue(line: string, tokensArray: IToken[]) {
    const startIndex = tokensArray.findIndex((token) => token.scopes.includes(ASSIGNATION_STATEMENT));
    const endIndex = tokensArray.length - 1;

    return tokensArray
      .filter((_, index) => index > startIndex && index < endIndex)
      .map((token) => this.getRawTokenContent(line, token))
      .join("")
      .trim();
  }

  private getFunctionParams(line: string, tokensArray: IToken[]) {
    const functionParamTokens = tokensArray.filter((token) => token.scopes.includes(FUNCTION_PARAMETER_SCOPE));

    return functionParamTokens.map((token) => {
      return {
        identifier: this.getRawTokenContent(line, token),
        tokenType: CompletionItemKind.TypeParameter,
        valueType: this.getTokenLanguageType(line, tokensArray[this.getTokenIndex(tokensArray, token) - 2]),
      };
    });
  }

  private tokenizeLinesForGlobalScope(lines: string[], startIndex: number = 0, stopIndex: number = -1) {
    const firstLineIndex = startIndex > lines.length || startIndex < 0 ? 0 : startIndex;
    const lastLineIndex = stopIndex > lines.length || stopIndex < 0 ? lines.length : stopIndex;
    const scope: GlobalScopeTokenizationResult = {
      complexTokens: [],
      structComplexTokens: [],
      children: [],
    };

    let ruleStack = INITIAL;
    let currentStruct: StructComplexToken | null = null;
    for (let currentIndex = firstLineIndex; currentIndex < lastLineIndex; currentIndex++) {
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
            } else if (lastIndex > 2 && !token.scopes.includes(BLOCK_DECLARACTION_SCOPE)) {
              currentStruct.data.properties.push({
                identifier: this.getRawTokenContent(line, tokensArray[3]),
                tokenType: CompletionItemKind.Property,
                valueType: this.getTokenLanguageType(line, tokensArray[1]),
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
            token.scopes.includes(CONSTANT_SCOPE) &&
            !token.scopes.includes(FUNCTION_SCOPE) &&
            !token.scopes.includes(BLOCK_SCOPE)
          ) {
            scope.complexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              data: {
                identifier: this.getRawTokenContent(line, token),
                tokenType: CompletionItemKind.Constant,
                valueType: this.getTokenLanguageType(line, tokensArray[index - 2]),
                value: this.getConstantValue(line, tokensArray),
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
                returnType: this.getTokenLanguageType(line, tokensArray[index - 2]),
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
    const firstLineIndex = startIndex > lines.length || startIndex < 0 ? 0 : startIndex;
    const lastLineIndex = stopIndex > lines.length || stopIndex < 0 ? lines.length : stopIndex;
    const scope: LocalScopeTokenizationResult = {
      functionsComplexTokens: [],
      functionVariablesComplexTokens: [],
    };

    let ruleStack = INITIAL;
    const tokensLines = lines.map((line) => {
      const tokenizedLine = this.grammar?.tokenizeLine(line, ruleStack);

      if (tokenizedLine) {
        ruleStack = tokenizedLine.ruleStack;
      }

      return tokenizedLine;
    });

    let computeFunctionLocals = false;

    for (let currentIndex = lastLineIndex; currentIndex >= firstLineIndex; currentIndex--) {
      const line = lines[currentIndex];
      const isLastLine = currentIndex === lastLineIndex;
      const tokensLine = tokensLines[currentIndex];
      const tokensArray = tokensLine?.tokens;

      if (tokensLine && tokensArray) {
        const lastIndex = tokensArray.length - 1;
        const lastToken = tokensArray[lastIndex];

        if (isLastLine && (lastToken.scopes.includes(BLOCK_SCOPE) || lastToken.scopes.includes(FUNCTION_SCOPE))) {
          computeFunctionLocals = true;
        }

        for (let index = 0; index < tokensArray.length; index++) {
          const token = tokensArray[index];

          if (isLastLine) {
            if (lastIndex > 1 && this.getRawTokenContent(line, tokensArray[lastIndex - 2]) === LanguageTypes.struct) {
              scope.structIdentifiersLineCandidate = currentIndex;
            } else if (
              lastIndex > 0 &&
              this.getRawTokenContent(line, tokensArray[lastIndex]) === TriggerCharacters.dot &&
              tokensArray[lastIndex - 1].scopes.includes(VARIABLE_SCOPE)
            ) {
              scope.structPropertiesCandidate = this.getRawTokenContent(line, tokensArray[lastIndex - 1]);
            }
          }

          // VARIABLE
          if (
            computeFunctionLocals &&
            token.scopes.includes(VARIABLE_SCOPE) &&
            index > 1 &&
            (tokensArray[index - 2].scopes.includes(TYPE_SCOPE) || tokensArray[index - 2].scopes.includes(STRUCT_SCOPE))
          ) {
            scope.functionVariablesComplexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              data: {
                identifier: this.getRawTokenContent(line, token),
                tokenType: CompletionItemKind.Variable,
                valueType: this.getTokenLanguageType(line, tokensArray[index - 2]),
              },
            });
          }

          // FUNCTION PARAM
          if (computeFunctionLocals && token.scopes.includes(FUNCTION_PARAMETER_SCOPE)) {
            scope.functionVariablesComplexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              data: {
                identifier: this.getRawTokenContent(line, token),
                tokenType: CompletionItemKind.TypeParameter,
                valueType: this.getTokenLanguageType(line, tokensArray[index - 2]),
              },
            });
          }

          // FUNCTION
          if (
            token.scopes.includes(FUNCTION_DECLARACTION_SCOPE) &&
            !lastToken.scopes.includes(TERMINATOR_STATEMENT) &&
            !token.scopes.includes(BLOCK_SCOPE)
          ) {
            scope.functionsComplexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              data: {
                identifier: this.getRawTokenContent(line, token),
                tokenType: CompletionItemKind.Function,
                returnType: this.getTokenLanguageType(line, tokensArray[index - 2]),
                params: this.getFunctionParams(line, tokensArray),
              },
            });
          }
        }

        // Needs to be after for allow more one iteration to fetch function params
        if (computeFunctionLocals && !lastToken.scopes.includes(BLOCK_SCOPE)) {
          computeFunctionLocals = false;
        }
      }
    }

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

  public findActionTargetIdentifier(content: string, position: Position) {
    let ruleStack = INITIAL;

    const lines = content.split(/\r?\n/);
    const line = lines[position.line];
    const tokensArray = this.grammar?.tokenizeLine(line, ruleStack)?.tokens;

    if (tokensArray) {
      return this.getRawTokenContent(
        line,
        tokensArray.find((token) => token.startIndex <= position.character && token.endIndex >= position.character)!
      );
    }

    return undefined;
  }

  public async loadGrammar() {
    this.grammar = await this.registry.loadGrammar("source.nss");

    return this;
  }
}
