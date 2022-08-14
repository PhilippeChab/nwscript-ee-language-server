import type { IGrammar } from "vscode-textmate";
import type { Position } from "vscode-languageserver-textdocument";
import { Registry, INITIAL, parseRawGrammar, IToken } from "vscode-textmate";
import { CompletionItemKind } from "vscode-languageserver";
import { join } from "path";

import type {
  ComplexToken,
  FunctionComplexToken,
  FunctionParamComplexToken,
  StructComplexToken,
  VariableComplexToken,
} from "./types";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { LanguageTypes, LanguageScopes } from "./constants";
import onigLib from "../onigLib";

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
  private localScopeCache: (IToken[] | undefined)[] | null = null;

  constructor(localPath = false) {
    this.registry = new Registry({
      onigLib,
      loadGrammar: (scopeName) => {
        return new Promise((resolve, reject) => {
          if (scopeName === "source.nss") {
            return WorkspaceFilesSystem.readFileAsync(
              join(__dirname, "..", "..", localPath ? ".." : "", "syntaxes", "nwscript-ee.tmLanguage")
            ).then((data) => resolve(parseRawGrammar((data as Buffer).toString())));
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

  private getTokenLanguageType(line: string, tokens: IToken[], index: number) {
    const rawContent = this.getRawTokenContent(line, tokens[index]);

    const type = LanguageTypes[rawContent as keyof typeof LanguageTypes] || rawContent;
    return (type === LanguageTypes.struct ? this.getRawTokenContent(line, tokens[index + 2]) : type) as LanguageTypes;
  }

  private getConstantValue(line: string, tokensArray: IToken[]) {
    const startIndex = tokensArray.findIndex((token) => token.scopes.includes(LanguageScopes.assignationStatement));
    const endIndex = tokensArray.findIndex((token) => token.scopes.includes(LanguageScopes.terminatorStatement));

    return tokensArray
      .filter((_, index) => index > startIndex && index < endIndex)
      .map((token) => this.getRawTokenContent(line, token))
      .join("")
      .trim();
  }

  private getFunctionParams(lineIndex: number, lines: string[], tokensArrays: (IToken[] | undefined)[]) {
    let params: FunctionParamComplexToken[] = [];
    let line;
    let tokensArray;

    lineIndex = lineIndex - 1;
    do {
      lineIndex = lineIndex + 1;
      line = lines[lineIndex];
      tokensArray = tokensArrays[lineIndex]!;

      params = params.concat(this.getInlineFunctionParams(line, lineIndex, tokensArray));
    } while (!Boolean(tokensArray.find((token) => token.scopes.includes(LanguageScopes.rightParametersRoundBracket))));

    return params;
  }

  private getInlineFunctionParams(line: string, lineIndex: number, tokensArray: IToken[]) {
    const functionParamTokens = tokensArray.filter(
      (token) =>
        token.scopes.includes(LanguageScopes.functionParameter) || token.scopes.includes(LanguageScopes.variableIdentifer)
    );

    return functionParamTokens.map((token) => {
      const tokenIndex = this.getTokenIndex(tokensArray, token);
      let defaultValue = "";

      if (tokensArray[tokenIndex + 2]?.scopes.includes(LanguageScopes.assignationStatement)) {
        let index = tokenIndex + 4;

        while (
          index < tokensArray.length &&
          !tokensArray[index].scopes.includes(LanguageScopes.separatorStatement) &&
          !tokensArray[index].scopes.includes(LanguageScopes.rightParametersRoundBracket) &&
          !tokensArray[index].scopes.includes(LanguageScopes.commentStatement)
        ) {
          defaultValue += this.getRawTokenContent(line, tokensArray[index]);
          index++;
        }
      }

      return {
        position: { line: lineIndex, character: token.startIndex },
        identifier: this.getRawTokenContent(line, token),
        tokenType: CompletionItemKind.TypeParameter,
        valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
        defaultValue: defaultValue.trim() || undefined,
      };
    });
  }

  private getFunctionComments(lines: string[], tokensLines: (IToken[] | undefined)[], index: number) {
    const comments: string[] = [];

    let errorSafeIndex = Math.max(index, 0);
    while (
      tokensLines[errorSafeIndex]
        ?.at(0)
        ?.scopes.find(
          (scope) => scope === LanguageScopes.commentStatement || scope === LanguageScopes.documentationCommentStatement
        )
    ) {
      comments.unshift(lines[errorSafeIndex]);
      errorSafeIndex--;
    }

    return comments;
  }

  private isFunctionDeclaration(lineIndex: number, tokensArrays: (IToken[] | undefined)[]) {
    let isFunctionDeclaration = false;
    let tokensArray = tokensArrays[lineIndex]!;
    let isLastParamsLine = false;

    while (!isLastParamsLine) {
      isLastParamsLine = Boolean(tokensArray.find((token) => token.scopes.includes(LanguageScopes.rightParametersRoundBracket)));

      if (isLastParamsLine && Boolean(tokensArray.find((token) => token.scopes.includes(LanguageScopes.terminatorStatement)))) {
        isFunctionDeclaration = true;
      }

      lineIndex = lineIndex + 1;
      tokensArray = tokensArrays[lineIndex]!;
    }

    return isFunctionDeclaration;
  }

  private tokenizeLinesForGlobalScope(lines: string[], startIndex: number = 0, stopIndex: number = -1) {
    const firstLineIndex = startIndex > lines.length || startIndex < 0 ? 0 : startIndex;
    const lastLineIndex = stopIndex + 10 > lines.length || stopIndex < 0 ? lines.length : stopIndex;
    const scope: GlobalScopeTokenizationResult = {
      complexTokens: [],
      structComplexTokens: [],
      children: [],
    };

    let ruleStack = INITIAL;
    const tokensArrays = lines.map((line) => {
      const tokenizedLine = this.grammar?.tokenizeLine(line, ruleStack);

      if (tokenizedLine) {
        ruleStack = tokenizedLine.ruleStack;
      }

      return tokenizedLine?.tokens;
    });

    let currentStruct: StructComplexToken | null = null;
    for (let lineIndex = firstLineIndex; lineIndex < lastLineIndex; lineIndex++) {
      const line = lines[lineIndex];
      const tokensArray = tokensArrays[lineIndex];

      if (tokensArray) {
        const lastIndex = tokensArray.length - 1;
        const lastToken = tokensArray[lastIndex];
        for (let tokenIndex = 0; tokenIndex < tokensArray.length; tokenIndex++) {
          const token = tokensArray[tokenIndex];

          // STRUCT PROPERTIES
          if (currentStruct) {
            if (token.scopes.includes(LanguageScopes.blockTermination)) {
              scope.structComplexTokens.push(currentStruct);
              currentStruct = null;
            } else if (lastIndex > 0 && tokensArray[1].scopes.includes(LanguageScopes.type)) {
              currentStruct.properties.push({
                position: { line: lineIndex, character: tokensArray[3].startIndex },
                identifier: this.getRawTokenContent(line, tokensArray[3]),
                tokenType: CompletionItemKind.Property,
                valueType: this.getTokenLanguageType(line, tokensArray, 1),
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
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Constant,
              valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
              value: this.getConstantValue(line, tokensArray),
            });
            break;
          }

          // FUNCTION
          if (
            token.scopes.includes(LanguageScopes.functionIdentifier) &&
            !token.scopes.includes(LanguageScopes.block) &&
            this.isFunctionDeclaration(lineIndex, tokensArrays) &&
            !(tokenIndex === 0 && lineIndex === 0)
          ) {
            scope.complexTokens.push({
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Function,
              returnType:
                tokenIndex === 0
                  ? this.getTokenLanguageType(lines[lineIndex - 1], tokensArrays[lineIndex - 1]!, 0)
                  : this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
              params: this.getFunctionParams(lineIndex, lines, tokensArrays),
              comments: this.getFunctionComments(lines, tokensArrays, tokenIndex === 0 ? lineIndex - 2 : lineIndex - 1),
            });

            break;
          }

          // STRUCT
          if (
            token.scopes.includes(LanguageScopes.structIdentifier) &&
            ((lastToken.scopes.includes(LanguageScopes.structIdentifier) &&
              tokensArrays[lineIndex + 1]?.at(0)?.scopes.includes(LanguageScopes.blockDeclaraction)) ||
              lastToken.scopes.includes(LanguageScopes.blockDeclaraction))
          ) {
            currentStruct = {
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Struct,
              properties: [],
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
    let tokensArrays;
    if (this.localScopeCache) {
      tokensArrays = this.localScopeCache;
      this.localScopeCache = null;
    } else {
      tokensArrays = lines.map((line) => {
        const tokenizedLine = this.grammar?.tokenizeLine(line, ruleStack);

        if (tokenizedLine) {
          ruleStack = tokenizedLine.ruleStack;
        }

        return tokenizedLine?.tokens;
      });
    }

    let computeFunctionLocals = false;

    for (let lineIndex = lastLineIndex; lineIndex >= firstLineIndex; lineIndex--) {
      const line = lines[lineIndex];
      const isLastLine = lineIndex === lastLineIndex;
      const tokensArray = tokensArrays[lineIndex];

      if (tokensArray) {
        const lastIndex = tokensArray.length - 1;
        const lastToken = tokensArray[lastIndex];

        if (
          isLastLine &&
          (lastToken.scopes.includes(LanguageScopes.block) || lastToken.scopes.includes(LanguageScopes.functionDeclaration))
        ) {
          computeFunctionLocals = true;
        }

        for (let tokenIndex = 0; tokenIndex < tokensArray.length; tokenIndex++) {
          const token = tokensArray[tokenIndex];

          // VARIABLE
          if (
            computeFunctionLocals &&
            token.scopes.includes(LanguageScopes.variableIdentifer) &&
            tokenIndex > 1 &&
            (tokensArray[tokenIndex - 2].scopes.includes(LanguageScopes.type) ||
              tokensArray[tokenIndex - 2].scopes.includes(LanguageScopes.structIdentifier))
          ) {
            scope.functionVariablesComplexTokens.push({
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Variable,
              valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
            });

            let nextVariableToken;
            let currentVariableIndex = tokenIndex;
            while (tokensArray[currentVariableIndex + 1].scopes.includes(LanguageScopes.separatorStatement)) {
              if (tokensArray[currentVariableIndex + 2].scopes.includes(LanguageScopes.variableIdentifer)) {
                currentVariableIndex = currentVariableIndex + 2;
              } else {
                currentVariableIndex = currentVariableIndex + 3;
              }

              nextVariableToken = tokensArray[currentVariableIndex];
              scope.functionVariablesComplexTokens.push({
                position: { line: lineIndex, character: nextVariableToken.startIndex },
                identifier: this.getRawTokenContent(line, nextVariableToken),
                tokenType: CompletionItemKind.Variable,
                valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
              });
            }
          }

          // FUNCTION PARAM
          if (computeFunctionLocals && token.scopes.includes(LanguageScopes.functionParameter)) {
            scope.functionVariablesComplexTokens.push({
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.TypeParameter,
              valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
            });
          }

          // FUNCTION
          if (
            token.scopes.includes(LanguageScopes.functionIdentifier) &&
            !token.scopes.includes(LanguageScopes.block) &&
            !this.isFunctionDeclaration(lineIndex, tokensArrays) &&
            !(tokenIndex === 0 && lineIndex === 0)
          ) {
            scope.functionsComplexTokens.push({
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Function,
              returnType:
                tokenIndex === 0
                  ? this.getTokenLanguageType(lines[lineIndex - 1], tokensArrays[lineIndex - 1]!, 0)
                  : this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
              params: this.getFunctionParams(lineIndex, lines, tokensArrays),
              comments: this.getFunctionComments(lines, tokensArrays, tokenIndex === 0 ? lineIndex - 2 : lineIndex - 1),
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

    const tokensArrays = lines.map((line) => {
      const tokenizedLine = this.grammar?.tokenizeLine(line, ruleStack);

      if (tokenizedLine) {
        ruleStack = tokenizedLine.ruleStack;
      }

      return tokenizedLine?.tokens;
    });
    this.localScopeCache = tokensArrays;

    const line = lines[position.line];
    const tokensArray = tokensArrays[position.line];

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
