import { join } from "path";
import { Registry, INITIAL, parseRawGrammar, IToken, ITokenizeLineResult } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { CompletionItemKind } from "vscode-languageserver";
import type { IGrammar } from "vscode-textmate";
import type { Position } from "vscode-languageserver-textdocument";

import type {
  ComplexToken,
  FunctionComplexToken,
  FunctionParamComplexToken,
  StructComplexToken,
  VariableComplexToken,
} from "./types";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { Logger } from "../Logger";
import { LanguageTypes, LanguageScopes } from "./constants";

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
};

export default class Tokenizer {
  private readonly registry: Registry;
  private grammar: IGrammar | null = null;
  private localScopeCache: (ITokenizeLineResult | undefined)[] | null = null;

  constructor(private readonly logger: Logger | null = null) {
    this.registry = new Registry({
      onigLib: vscodeOnigurumaLib,
      loadGrammar: (scopeName) => {
        return new Promise((resolve, reject) => {
          if (scopeName === "source.nss") {
            return WorkspaceFilesSystem.readFileAsync(join(__dirname, "..", "..", "..", "syntaxes", "nwscript.tmLanguage")).then(
              (data) => resolve(parseRawGrammar((data as Buffer).toString()))
            );
          }

          reject(`Unknown scope name: ${scopeName}`);
        });
      },
    });
  }

  private getTokenIndexAtPosition(tokensArray: IToken[], position: Position) {
    return tokensArray.findIndex((token) => token.startIndex <= position.character && token.endIndex >= position.character)!;
  }

  private getTokenAtPosition(tokensArray: IToken[], position: Position) {
    return tokensArray.find((token) => token.startIndex <= position.character && token.endIndex >= position.character);
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
    const startIndex = tokensArray.findIndex((token) => token.scopes.includes(LanguageScopes.assignationStatement));
    const endIndex = tokensArray.length - 1;

    return tokensArray
      .filter((_, index) => index > startIndex && index < endIndex)
      .map((token) => this.getRawTokenContent(line, token))
      .join("")
      .trim();
  }

  private getFunctionParams(line: string, lineIndex: number, tokensArray: IToken[]) {
    const functionParamTokens = tokensArray.filter((token) => token.scopes.includes(LanguageScopes.functionParameter));

    return functionParamTokens.map((token) => {
      return {
        position: { line: lineIndex, character: token.startIndex },
        identifier: this.getRawTokenContent(line, token),
        tokenType: CompletionItemKind.TypeParameter,
        valueType: this.getTokenLanguageType(line, tokensArray[this.getTokenIndex(tokensArray, token) - 2]),
      };
    });
  }

  private getLocalFunctionComments(lines: string[], tokensLines: (ITokenizeLineResult | undefined)[]) {
    const comments: string[] = [];

    let index = Math.max(tokensLines.length - 1, 0);
    while (tokensLines[index]?.tokens.at(0)?.scopes.includes(LanguageScopes.commentStatement)) {
      comments.push(lines[index]);
      index--;
    }

    return comments;
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
    let comments: string[] = [];
    for (let currentIndex = firstLineIndex; currentIndex < lastLineIndex; currentIndex++) {
      const line = lines[currentIndex];
      const tokensLine = this.grammar?.tokenizeLine(line, ruleStack);
      const tokensArray = tokensLine?.tokens;

      if (tokensLine && tokensArray) {
        ruleStack = tokensLine.ruleStack;

        const firstToken = tokensArray[0];
        if (firstToken.scopes.includes(LanguageScopes.commentStatement)) {
          comments.push(line);
          continue;
        }

        const lastIndex = tokensArray.length - 1;
        const lastToken = tokensArray[lastIndex];
        for (let index = 0; index < tokensArray.length; index++) {
          const token = tokensArray[index];

          // STRUCT PROPERTIES
          if (currentStruct) {
            if (token.scopes.includes(LanguageScopes.blockTermination)) {
              scope.structComplexTokens.push(currentStruct);
              currentStruct = null;
            } else if (lastIndex > 2 && !token.scopes.includes(LanguageScopes.blockDeclaraction)) {
              currentStruct.properties.push({
                position: { line: currentIndex, character: tokensArray[3].startIndex },
                identifier: this.getRawTokenContent(line, tokensArray[3]),
                tokenType: CompletionItemKind.Property,
                valueType: this.getTokenLanguageType(line, tokensArray[1]),
              });
            }

            break;
          }

          // CHILD
          {
            if (token.scopes.includes(LanguageScopes.includeDeclaration)) {
              scope.children.push(this.getRawTokenContent(line, tokensArray.at(-2)!));
              break;
            }
          }

          // CONSTANT
          if (
            token.scopes.includes(LanguageScopes.constantIdentifer) &&
            !token.scopes.includes(LanguageScopes.functionDeclaration) &&
            !token.scopes.includes(LanguageScopes.block)
          ) {
            scope.complexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Constant,
              valueType: this.getTokenLanguageType(line, tokensArray[index - 2]),
              value: this.getConstantValue(line, tokensArray),
            });
            break;
          }

          // FUNCTION
          if (
            token.scopes.includes(LanguageScopes.functionIdentifier) &&
            lastToken.scopes.includes(LanguageScopes.terminatorStatement) &&
            !token.scopes.includes(LanguageScopes.block)
          ) {
            scope.complexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Function,
              returnType: this.getTokenLanguageType(line, tokensArray[index - 2]),
              params: this.getFunctionParams(line, currentIndex, tokensArray),
              comments,
            });
            break;
          }

          // STRUCT
          if (
            token.scopes.includes(LanguageScopes.structIdentifier) &&
            (lastToken.scopes.includes(LanguageScopes.structIdentifier) ||
              lastToken.scopes.includes(LanguageScopes.blockDeclaraction))
          ) {
            currentStruct = {
              position: { line: currentIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Struct,
              properties: [],
            };
            break;
          }
        }
      }

      comments = [];
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
    let tokensLines;
    if (this.localScopeCache) {
      tokensLines = this.localScopeCache;
      this.localScopeCache = null;
    } else {
      tokensLines = lines.map((line) => {
        const tokenizedLine = this.grammar?.tokenizeLine(line, ruleStack);

        if (tokenizedLine) {
          ruleStack = tokenizedLine.ruleStack;
        }

        return tokenizedLine;
      });
    }

    let computeFunctionLocals = false;

    for (let currentIndex = lastLineIndex; currentIndex >= firstLineIndex; currentIndex--) {
      const line = lines[currentIndex];
      const isLastLine = currentIndex === lastLineIndex;
      const tokensLine = tokensLines[currentIndex];
      const tokensArray = tokensLine?.tokens;

      if (tokensLine && tokensArray) {
        const lastIndex = tokensArray.length - 1;
        const lastToken = tokensArray[lastIndex];

        if (
          isLastLine &&
          (lastToken.scopes.includes(LanguageScopes.block) || lastToken.scopes.includes(LanguageScopes.functionDeclaration))
        ) {
          computeFunctionLocals = true;
        }

        for (let index = 0; index < tokensArray.length; index++) {
          const token = tokensArray[index];

          // VARIABLE
          if (
            computeFunctionLocals &&
            token.scopes.includes(LanguageScopes.variableIdentifer) &&
            index > 1 &&
            (tokensArray[index - 2].scopes.includes(LanguageScopes.type) ||
              tokensArray[index - 2].scopes.includes(LanguageScopes.structIdentifier))
          ) {
            scope.functionVariablesComplexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Variable,
              valueType: this.getTokenLanguageType(line, tokensArray[index - 2]),
            });
          }

          // FUNCTION PARAM
          if (computeFunctionLocals && token.scopes.includes(LanguageScopes.functionParameter)) {
            scope.functionVariablesComplexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.TypeParameter,
              valueType: this.getTokenLanguageType(line, tokensArray[index - 2]),
            });
          }

          // FUNCTION
          if (
            token.scopes.includes(LanguageScopes.functionIdentifier) &&
            !lastToken.scopes.includes(LanguageScopes.terminatorStatement) &&
            !token.scopes.includes(LanguageScopes.block)
          ) {
            scope.functionsComplexTokens.push({
              position: { line: currentIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Function,
              returnType: this.getTokenLanguageType(line, tokensArray[index - 2]),
              params: this.getFunctionParams(line, index, tokensArray),
              comments: this.getLocalFunctionComments(lines, tokensLines),
            });
          }
        }

        // Needs to be after for allow more one iteration to fetch function params
        if (computeFunctionLocals && !lastToken.scopes.includes(LanguageScopes.block)) {
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

  public isInLanguageScope(content: string, position: Position, tokenizedScope: LanguageScopes) {
    let ruleStack = INITIAL;
    const lines = content.split(/\r?\n/);

    const tokensLines = lines.map((line) => {
      const tokenizedLine = this.grammar?.tokenizeLine(line, ruleStack);

      if (tokenizedLine) {
        ruleStack = tokenizedLine.ruleStack;
      }

      return tokenizedLine;
    });
    this.localScopeCache = tokensLines;

    const line = lines[position.line];
    const tokensArray = tokensLines[position.line]?.tokens;

    if (tokensArray && this.getTokenAtPosition(tokensArray, position)?.scopes.includes(tokenizedScope)) {
      return { line, tokensArray };
    }

    return false;
  }

  public findIdentiferFromPositionForLanguageScopes(
    line: string,
    tokensArray: IToken[],
    position: Position,
    languageScopes: LanguageScopes[]
  ) {
    let identifier: string | undefined;
    const tokenIndex = this.getTokenIndexAtPosition(tokensArray, position);

    for (let currentIndex = tokenIndex; currentIndex >= 0; currentIndex--) {
      const token = tokensArray[currentIndex];
      if (languageScopes.every((scope) => token.scopes.includes(scope))) {
        identifier = this.getRawTokenContent(line, token);
      }
    }

    return identifier;
  }

  public getLanguageScopeOccurencesFromPositionWithDelimiter(
    tokensArray: IToken[],
    position: Position,
    occurencesTarget: LanguageScopes,
    delimiter: LanguageScopes
  ) {
    let occurences = 0;

    let currentIndex = this.getTokenIndexAtPosition(tokensArray, position);
    while (currentIndex >= 0 && !tokensArray[currentIndex].scopes.includes(delimiter)) {
      if (tokensArray[currentIndex].scopes.includes(occurencesTarget)) {
        occurences++;
      }

      currentIndex--;
    }

    return occurences;
  }

  public findLineIdentiferFromPositionAt(content: string, position: Position, index: number) {
    let ruleStack = INITIAL;

    const lines = content.split(/\r?\n/);
    const line = lines[position.line];
    const tokensArray = this.grammar?.tokenizeLine(line, ruleStack)?.tokens;
    const arrayLength = tokensArray?.length || 0;

    if ((index > 0 && Math.abs(index) >= arrayLength) || (index < 0 && Math.abs(index) > arrayLength)) {
      return undefined;
    }

    return this.getRawTokenContent(line, tokensArray?.at(index)!);
  }

  public findFirstIdentiferForLanguageScope(line: string, languageScope: LanguageScopes) {
    const tokensArray = this.grammar?.tokenizeLine(line, INITIAL)?.tokens;

    const token = tokensArray?.find((token) => token.scopes.includes(languageScope));

    if (token) {
      return this.getRawTokenContent(line, token);
    }

    return undefined;
  }

  public findActionTargetAtPosition(content: string, position: Position) {
    let ruleStack = INITIAL;

    let tokenType = undefined;
    let structVariableIdentifier = undefined;
    const lines = content.split(/\r?\n/);
    const line = lines[position.line];
    const tokensArray = this.grammar?.tokenizeLine(line, ruleStack)?.tokens;

    if (tokensArray) {
      const tokenIndex = this.getTokenIndexAtPosition(tokensArray, position);
      const token = tokensArray[tokenIndex];

      if (token.scopes.includes(LanguageScopes.structProperty)) {
        tokenType = CompletionItemKind.Property;
        structVariableIdentifier = this.getRawTokenContent(line, tokensArray[tokenIndex - 2]);
      } else if (token.scopes.includes(LanguageScopes.structIdentifier)) {
        tokenType = CompletionItemKind.Struct;
      } else if (token.scopes.includes(LanguageScopes.constantIdentifer)) {
        tokenType = CompletionItemKind.Constant;
      } else if (token.scopes.includes(LanguageScopes.functionIdentifier)) {
        tokenType = CompletionItemKind.Function;
      }

      return {
        tokenType,
        structVariableIdentifier,
        identifier: this.getRawTokenContent(line, token),
      };
    }

    return {
      tokenType,
      structVariableIdentifier,
      identifier: undefined,
    };
  }

  public async loadGrammar() {
    this.grammar = await this.registry.loadGrammar("source.nss");

    return this;
  }
}
