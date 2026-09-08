import { join } from "path";
import { readFileSync } from "fs";

import type { IGrammar } from "vscode-textmate";
import type { Position } from "vscode-languageserver-textdocument";
import { Registry, INITIAL, parseRawGrammar, IToken } from "vscode-textmate";
import { CompletionItemKind } from "vscode-languageserver";

import type { ComplexToken, FunctionComplexToken, FunctionParamComplexToken, StructComplexToken, VariableComplexToken } from "./types";
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

// Naive implementation
// Ideally we would use an AST tree
// See the Notes section of the README for the explications
export default class Tokenizer {
  private readonly registry: Registry;
  private grammar: IGrammar | null = null;
  private readonly localScopeCache: (IToken[] | undefined)[] | null = null;

  constructor(localPath = false) {
    this.registry = new Registry({
      onigLib,
      loadGrammar: async (scopeName) => {
        return await new Promise((resolve, reject) => {
          if (scopeName === "source.nss") {
            const grammar = readFileSync(join(__dirname, "..", "..", localPath ? ".." : "", "syntaxes", "nwscript-ee.tmLanguage"));

            return resolve(parseRawGrammar(grammar.toString()));
          }

          reject(new Error(`Unknown scope name: ${scopeName}`));
        });
      },
    });
  }

  private getTokenIndexAtPosition(tokensArray: IToken[], position: Position) {
    return tokensArray.findIndex((token) => token.startIndex <= position.character && token.endIndex >= position.character);
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
      (token) => token.scopes.includes(LanguageScopes.functionParameters) && (token.scopes.includes(LanguageScopes.functionParameter) || token.scopes.includes(LanguageScopes.variableIdentifer)),
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
    while (tokensLines[errorSafeIndex]?.at(0)?.scopes.find((scope) => scope === LanguageScopes.commentStatement || scope === LanguageScopes.documentationCommentStatement)) {
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

      if (isLastParamsLine && Boolean(tokensArray.find((token) => token.scopes.includes(LanguageScopes.terminatorStatement) && !token.scopes.includes(LanguageScopes.block)))) {
        isFunctionDeclaration = true;
      }

      lineIndex = lineIndex + 1;
      tokensArray = tokensArrays[lineIndex]!;
    }

    return isFunctionDeclaration;
  }

  private isGlobalFunctionDeclaration(lineIndex: number, tokenIndex: number, token: IToken, tokensArrays: (IToken[] | undefined)[]) {
    return (
      !(tokenIndex === 0 && lineIndex === 0) && // Not sure why we need this
      !token.scopes.includes(LanguageScopes.block) &&
      token.scopes.includes(LanguageScopes.functionIdentifier) &&
      this.isFunctionDeclaration(lineIndex, tokensArrays)
    );
  }

  private isLocalFunctionDeclaration(lineIndex: number, tokenIndex: number, token: IToken, tokensArrays: (IToken[] | undefined)[]) {
    return (
      token.scopes.includes(LanguageScopes.functionIdentifier) &&
      !token.scopes.includes(LanguageScopes.block) &&
      !(tokenIndex === 0 && lineIndex === 0) && // Not sure why we need this
      !this.isFunctionDeclaration(lineIndex, tokensArrays)
    );
  }

  private isGlobalConstant(token: IToken) {
    return token.scopes.includes(LanguageScopes.constantIdentifer) && !token.scopes.includes(LanguageScopes.functionDeclaration) && !token.scopes.includes(LanguageScopes.block);
  }

  private isStructDeclaration(token: IToken, lastToken: IToken, lineIndex: number, tokensArrays: (IToken[] | undefined)[]) {
    return (
      token.scopes.includes(LanguageScopes.structIdentifier) &&
      ((tokensArrays[lineIndex + 1]?.at(0)?.scopes.includes(LanguageScopes.blockDeclaraction) && lastToken.scopes.includes(LanguageScopes.structIdentifier)) ||
        lastToken.scopes.includes(LanguageScopes.blockDeclaraction))
    );
  }

  private isLocalVariable(tokenIndex: number, token: IToken, tokensArray: IToken[]) {
    return (
      token.scopes.includes(LanguageScopes.variableIdentifer) &&
      tokenIndex > 1 &&
      (tokensArray[tokenIndex - 2].scopes.includes(LanguageScopes.type) || tokensArray[tokenIndex - 2].scopes.includes(LanguageScopes.structIdentifier))
    );
  }

  private tokenizeLinesForGlobalScope(lines: string[], tokensArrays: (IToken[] | undefined)[], startIndex: number = 0, stopIndex: number = -1) {
    const firstLineIndex = startIndex > lines.length || startIndex < 0 ? 0 : startIndex;
    const lastLineIndex = stopIndex + 10 > lines.length || stopIndex < 0 ? lines.length : stopIndex;
    const scope: GlobalScopeTokenizationResult = {
      complexTokens: [],
      structComplexTokens: [],
      children: [],
    };

    let currentStruct: StructComplexToken | null = null;
    for (let lineIndex = firstLineIndex; lineIndex < lastLineIndex; lineIndex++) {
      const line = lines[lineIndex];
      const tokensArray = tokensArrays[lineIndex];

      if (tokensArray) {
        const lastIndex = tokensArray.length - 1;
        const lastToken = tokensArray[lastIndex];
        for (let tokenIndex = 0; tokenIndex < tokensArray.length; tokenIndex++) {
          const token = tokensArray[tokenIndex];

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

          if (token.scopes.includes(LanguageScopes.includeDeclaration)) {
            scope.children.push(this.getRawTokenContent(line, tokensArray.at(-2)!));
            break;
          }

          if (this.isGlobalConstant(token)) {
            scope.complexTokens.push({
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Constant,
              valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
              value: this.getConstantValue(line, tokensArray),
            });
            break;
          }

          if (this.isGlobalFunctionDeclaration(lineIndex, tokenIndex, token, tokensArrays)) {
            scope.complexTokens.push({
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Function,
              returnType: tokenIndex === 0 ? this.getTokenLanguageType(lines[lineIndex - 1], tokensArrays[lineIndex - 1]!, 0) : this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
              params: this.getFunctionParams(lineIndex, lines, tokensArrays),
              comments: this.getFunctionComments(lines, tokensArrays, tokenIndex === 0 ? lineIndex - 2 : lineIndex - 1),
            });

            break;
          }

          if (this.isStructDeclaration(token, lastToken, lineIndex, tokensArrays)) {
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

  private tokenizeLinesForLocalScope(lines: string[], tokensArrays: (IToken[] | undefined)[], startIndex: number = 0, stopIndex: number = -1) {
    const firstLineIndex = startIndex > lines.length || startIndex < 0 ? 0 : startIndex;
    const lastLineIndex = stopIndex > lines.length || stopIndex < 0 ? lines.length : stopIndex;
    const scope: LocalScopeTokenizationResult = {
      functionsComplexTokens: [],
      functionVariablesComplexTokens: [],
    };

    let computeFunctionLocals = false;
    let currentFunctionVariables = [];

    for (let lineIndex = lastLineIndex; lineIndex >= firstLineIndex; lineIndex--) {
      const line = lines[lineIndex];
      const isLastLine = lineIndex === lastLineIndex;
      const tokensArray = tokensArrays[lineIndex];

      if (tokensArray) {
        const lastIndex = tokensArray.length - 1;
        const lastToken = tokensArray[lastIndex];

        if (
          (lastToken.scopes.includes(LanguageScopes.block) && lastToken.scopes.includes(LanguageScopes.blockTermination) && lastLineIndex === lines.length) ||
          (isLastLine && (lastToken.scopes.includes(LanguageScopes.block) || lastToken.scopes.includes(LanguageScopes.functionDeclaration)))
        ) {
          computeFunctionLocals = true;
        }

        for (let tokenIndex = 0; tokenIndex < tokensArray.length; tokenIndex++) {
          const token = tokensArray[tokenIndex];

          if (computeFunctionLocals && this.isLocalVariable(tokenIndex, token, tokensArray)) {
            const complexToken = {
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Variable,
              valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
            };
            scope.functionVariablesComplexTokens.push(complexToken);
            currentFunctionVariables.push(complexToken);

            let nextVariableToken;
            let currentVariableIndex = tokenIndex;
            while (tokensArray[currentVariableIndex + 1] && tokensArray[currentVariableIndex + 1].scopes.includes(LanguageScopes.separatorStatement)) {
              if (tokensArray[currentVariableIndex + 2].scopes.includes(LanguageScopes.variableIdentifer)) {
                currentVariableIndex = currentVariableIndex + 2;
              } else {
                currentVariableIndex = currentVariableIndex + 3;
              }

              nextVariableToken = tokensArray[currentVariableIndex];
              const complextToken = {
                position: { line: lineIndex, character: nextVariableToken.startIndex },
                identifier: this.getRawTokenContent(line, nextVariableToken),
                tokenType: CompletionItemKind.Variable,
                valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
              };
              scope.functionVariablesComplexTokens.push(complextToken);
              currentFunctionVariables.push(complexToken);
            }
          }

          if (computeFunctionLocals && token.scopes.includes(LanguageScopes.functionParameter)) {
            scope.functionVariablesComplexTokens.push({
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.TypeParameter,
              valueType: this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
            });
          }

          if (this.isLocalFunctionDeclaration(lineIndex, tokenIndex, token, tokensArrays)) {
            scope.functionsComplexTokens.push({
              position: { line: lineIndex, character: token.startIndex },
              identifier: this.getRawTokenContent(line, token),
              tokenType: CompletionItemKind.Function,
              returnType: tokenIndex === 0 ? this.getTokenLanguageType(lines[lineIndex - 1], tokensArrays[lineIndex - 1]!, 0) : this.getTokenLanguageType(line, tokensArray, tokenIndex - 2),
              params: this.getFunctionParams(lineIndex, lines, tokensArrays),
              comments: this.getFunctionComments(lines, tokensArrays, tokenIndex === 0 ? lineIndex - 2 : lineIndex - 1),
              variables: currentFunctionVariables,
            });
          }
        }

        // Needs to be after to allow one more iteration to fetch function params
        if (computeFunctionLocals && !lastToken.scopes.includes(LanguageScopes.block)) {
          computeFunctionLocals = false;
          currentFunctionVariables = [];
        }
      }
    }

    return scope;
  }

  public tokenizeContent(content: string, scope: TokenizedScope.global, startIndex?: number, stopIndex?: number): GlobalScopeTokenizationResult;
  public tokenizeContent(content: string, scope: TokenizedScope.local, startIndex?: number, stopIndex?: number): LocalScopeTokenizationResult;
  public tokenizeContent(content: string, scope: TokenizedScope, startIndex: number = 0, stopIndex: number = -1) {
    const [lines, rawTokenizedContent] = this.tokenizeContentToRaw(content);

    if (scope === TokenizedScope.global) {
      return this.tokenizeLinesForGlobalScope(lines, rawTokenizedContent, startIndex, stopIndex);
    } else {
      return this.tokenizeLinesForLocalScope(lines, rawTokenizedContent, startIndex, stopIndex);
    }
  }

  public tokenizeContentFromRaw(lines: string[], rawTokenizedContent: (IToken[] | undefined)[], startIndex: number = 0, stopIndex: number = -1) {
    return this.tokenizeLinesForLocalScope(lines, rawTokenizedContent, startIndex, stopIndex);
  }

  public tokenizeContentToRaw(content: string): [lines: string[], rawTokenizedContent: (IToken[] | undefined)[]] {
    const lines = content.split(/\r?\n/);
    let ruleStack = INITIAL;

    return [
      lines,
      lines.map((line) => {
        const tokenizedLine = this.grammar?.tokenizeLine(line, ruleStack);

        if (tokenizedLine) {
          ruleStack = tokenizedLine.ruleStack;
        }

        return tokenizedLine?.tokens;
      }),
    ];
  }

  public getActionTargetAtPosition(lines: string[], tokensArrays: (IToken[] | undefined)[], position: Position, offset: number = 0) {
    let tokenType;
    let lookBehindRawContent;

    const line = lines[position.line];
    const tokensArray = tokensArrays[position.line];

    if (!tokensArray) {
      return {
        tokenType,
        lookBehindRawContent,
        rawContent: undefined,
      };
    }

    const arrayLength = tokensArray.length;
    const tokenIndex = this.getTokenIndexAtPosition(tokensArray, position);

    if (tokenIndex + offset >= arrayLength || tokenIndex - Math.abs(offset) < 0) {
      return {
        tokenType,
        lookBehindRawContent,
        rawContent: undefined,
      };
    }

    const token = tokensArray[tokenIndex + offset];

    if (token.scopes.includes(LanguageScopes.structProperty)) {
      tokenType = CompletionItemKind.Property;
      lookBehindRawContent = this.getRawTokenContent(line, tokensArray[tokenIndex - 2]);
    } else if (token.scopes.includes(LanguageScopes.structIdentifier)) {
      tokenType = CompletionItemKind.Struct;
    } else if (token.scopes.includes(LanguageScopes.constantIdentifer)) {
      tokenType = CompletionItemKind.Constant;
    } else if (token.scopes.includes(LanguageScopes.functionIdentifier)) {
      tokenType = CompletionItemKind.Function;
    }

    return {
      tokenType,
      lookBehindRawContent,
      rawContent: this.getRawTokenContent(line, token),
    };
  }

  public getLookBehindScopesRawContent(line: string, tokensArray: IToken[], position: Position, languageScopes: LanguageScopes[]) {
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

  public getLookBehindScopeOccurences(tokensArray: IToken[], position: Position, occurencesTarget: LanguageScopes, delimiter: LanguageScopes) {
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

  public isInScope(tokensArray: IToken[], position: Position, scope: LanguageScopes) {
    return this.getTokenAtPosition(tokensArray, position)?.scopes.includes(scope);
  }

  public async loadGrammar() {
    this.grammar = await this.registry.loadGrammar("source.nss");

    return this;
  }
}
