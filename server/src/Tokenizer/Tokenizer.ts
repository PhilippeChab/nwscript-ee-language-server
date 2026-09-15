import { join } from "path";
import { readFileSync } from "fs";

import type { IGrammar } from "vscode-textmate";
import type { Position, TextDocument } from "vscode-languageserver-textdocument";
import { Registry, INITIAL, parseRawGrammar, IToken } from "vscode-textmate";
import { CompletionItemKind, Range } from "vscode-languageserver";

import type { ComplexToken, FunctionComplexToken, FunctionParamComplexToken, MemberReferenceComplexToken, StructComplexToken, VariableComplexToken } from "./types";
import { LanguageTypes, LanguageScopes } from "./constants";
import onigLib from "../onigLib";

export enum TokenizationMode {
  document = "document",
  local = "local",
}

// The document index includes import-conflict metadata. Only globalDeclarations
// and structDeclarations provide globally visible symbols; indexed locals retain
// their original scope and member references are not resolved symbols.
export type DocumentTokenizationResult = {
  globalDeclarations: ComplexToken[];
  structDeclarations: StructComplexToken[];
  children: string[];
  includePositions?: Position[];
  entryPointDeclarations?: FunctionComplexToken[];
  localDeclarations?: (VariableComplexToken | FunctionParamComplexToken)[];
  memberReferences?: MemberReferenceComplexToken[];
};

export type LocalScopeTokenizationResult = {
  functionsComplexTokens: FunctionComplexToken[];
  functionVariablesComplexTokens: (VariableComplexToken | FunctionParamComplexToken)[];
};

export type AutoImportContext = {
  prefix: string;
  replacementRange: Range;
  insertionPosition: Position;
  structsOnly: boolean;
};

// Naive implementation
// Ideally we would use an AST tree
// See the Notes section of the README for the explications
export default class Tokenizer {
  private readonly documentTokenCache = new WeakMap<TextDocument, { version: number; scope: DocumentTokenizationResult } | { version: number; error: Error }>();
  private readonly registry: Registry;
  private grammar: IGrammar | null = null;

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

  public tokenizeDocument(document: TextDocument): DocumentTokenizationResult {
    const cached = this.documentTokenCache.get(document);
    if (cached?.version === document.version) {
      if ("error" in cached) throw cached.error;
      return cached.scope;
    }
    try {
      const scope = this.tokenizeContent(document.getText(), TokenizationMode.document);
      this.documentTokenCache.set(document, { version: document.version, scope });
      return scope;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.documentTokenCache.set(document, { version: document.version, error: failure });
      throw failure;
    }
  }

  public getAutoImportContextFromRaw(lines: string[], tokensArrays: (IToken[] | undefined)[], position: Position): AutoImportContext | undefined {
    const line = lines[position.line];
    const tokens = tokensArrays[position.line];
    if (line === undefined || !tokens) return;
    // At a token boundary, completion applies to the text immediately to the left.
    const character = Math.max(0, position.character - 1);
    const token = tokens.find((candidate) => candidate.startIndex <= character && candidate.endIndex > character);
    if (!token || this.isInCommentOrStringFromRaw(tokensArrays, position) || token.scopes.includes(LanguageScopes.includeDeclaration)) return;
    const identifierScopes = [LanguageScopes.variableIdentifer, LanguageScopes.constantIdentifer, LanguageScopes.functionIdentifier, LanguageScopes.structIdentifier];
    const isIdentifier = identifierScopes.some((scope) => token.scopes.includes(scope));
    const replacementRange = isIdentifier ? Range.create(position.line, token.startIndex, position.line, Math.min(line.length, token.endIndex)) : Range.create(position, position);
    const previous = tokens.filter((candidate) => candidate.endIndex <= replacementRange.start.character && this.getRawTokenContent(line, candidate).trim()).at(-1);
    if (token.scopes.includes(LanguageScopes.structProperty) || token.scopes.includes(LanguageScopes.dotAccessStatement) || previous?.scopes.includes(LanguageScopes.dotAccessStatement)) return;

    const insertionPosition = this.getIncludeInsertionPosition(lines, tokensArrays);
    if (insertionPosition.line > replacementRange.start.line || (insertionPosition.line === replacementRange.start.line && insertionPosition.character > replacementRange.start.character)) return;
    return {
      prefix: line.slice(replacementRange.start.character, position.character),
      replacementRange,
      structsOnly: previous !== undefined && this.getRawTokenContent(line, previous) === LanguageTypes.struct,
      insertionPosition,
    };
  }

  public isInCommentOrStringFromRaw(tokensArrays: (IToken[] | undefined)[], position: Position): boolean {
    const character = Math.max(0, position.character - 1);
    const token = tokensArrays[position.line]?.find((candidate) => candidate.startIndex <= character && candidate.endIndex > character);
    if (!token) return false;
    if (position.character === token.endIndex && token.scopes.includes(LanguageScopes.stringEnd)) return false;
    return this.isCommentToken(token) || token.scopes.some((scope) => scope.startsWith("string."));
  }

  public tokenizeContent(content: string, mode: TokenizationMode.document, startIndex?: number, stopIndex?: number): DocumentTokenizationResult;
  public tokenizeContent(content: string, mode: TokenizationMode.local, startIndex?: number, stopIndex?: number): LocalScopeTokenizationResult;
  public tokenizeContent(content: string, mode: TokenizationMode, startIndex: number = 0, stopIndex: number = -1) {
    const [lines, rawTokenizedContent] = this.tokenizeContentToRaw(content);

    if (mode === TokenizationMode.document) {
      return this.tokenizeDocumentLines(lines, rawTokenizedContent, startIndex, stopIndex);
    } else {
      return this.tokenizeLinesForLocalScope(lines, rawTokenizedContent, startIndex, stopIndex);
    }
  }

  public tokenizeContentFromRaw(lines: string[], rawTokenizedContent: (IToken[] | undefined)[], startIndex: number = 0, stopIndex: number = -1, character = Number.POSITIVE_INFINITY) {
    return this.tokenizeLinesForLocalScope(lines, rawTokenizedContent, startIndex, stopIndex, character);
  }

  public tokenizeDocumentFromRaw(lines: string[], rawTokenizedContent: (IToken[] | undefined)[]) {
    return this.tokenizeDocumentLines(lines, rawTokenizedContent, 0, -1, true);
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

  public getMemberAccessFromRaw(lines: string[], tokensArrays: (IToken[] | undefined)[], position: Position) {
    const names: string[] = [];
    let expectName = true;
    let started = false;
    let memberAccess = false;
    // An empty path preserves member context when its receiver cannot be resolved.
    const result = () => (!expectName && names.length > 1 ? names.reverse() : memberAccess ? [] : undefined);
    for (let line = position.line; line >= 0; line--) {
      const tokens = tokensArrays[line] || [];
      let index = line === position.line ? this.getTokenIndexAtPosition(tokens, position) : tokens.length - 1;
      for (; index >= 0; index--) {
        const token = tokens[index];
        const text = this.getRawTokenContent(lines[line], token).trim();
        if (!text) continue;
        if (this.isCommentToken(token)) {
          if (!started) return;
          continue;
        }
        if (token.scopes.some((scope) => scope.startsWith("string."))) return memberAccess ? [] : undefined;
        if (!started && token.scopes.includes(LanguageScopes.dotAccessStatement)) {
          memberAccess = true;
          names.push("");
        } else if (expectName && (this.isVariableIdentifier(token) || token.scopes.includes(LanguageScopes.structProperty))) {
          names.push(text);
          expectName = false;
        } else if (!expectName && token.scopes.includes(LanguageScopes.dotAccessStatement)) {
          memberAccess = true;
          expectName = true;
        } else {
          return result();
        }
        started = true;
      }
    }
    return result();
  }

  public getActionTargetAtPosition(lines: string[], tokensArrays: (IToken[] | undefined)[], position: Position, offset: number = 0) {
    let tokenType;

    const line = lines[position.line];
    const tokensArray = tokensArrays[position.line];

    if (!tokensArray) {
      return {
        tokenType,
        rawContent: undefined,
      };
    }

    const arrayLength = tokensArray.length;
    const tokenIndex = this.getTokenIndexAtPosition(tokensArray, position);

    if (tokenIndex + offset >= arrayLength || tokenIndex - Math.abs(offset) < 0) {
      return {
        tokenType,
        rawContent: undefined,
      };
    }

    const token = tokensArray[tokenIndex + offset];
    if (this.isCommentToken(token) || token.scopes.some((scope) => scope.startsWith("string."))) {
      return { tokenType, rawContent: undefined };
    }

    if (token.scopes.includes(LanguageScopes.structProperty)) {
      tokenType = CompletionItemKind.Property;
    } else if (token.scopes.includes(LanguageScopes.structIdentifier)) {
      tokenType = CompletionItemKind.Struct;
    } else if (token.scopes.includes(LanguageScopes.constantIdentifer)) {
      tokenType = CompletionItemKind.Constant;
    } else if (token.scopes.includes(LanguageScopes.functionIdentifier)) {
      tokenType = CompletionItemKind.Function;
    }

    return {
      tokenType,
      rawContent: this.getRawTokenContent(line, token),
    };
  }

  public getCallContextFromRaw(lines: string[], tokensArrays: (IToken[] | undefined)[], position: Position) {
    const calls: { identifier?: string; activeParameter: number }[] = [];
    let identifier: string | undefined;
    for (let lineIndex = 0; lineIndex <= position.line; lineIndex++) {
      for (const token of tokensArrays[lineIndex] || []) {
        if (lineIndex === position.line && token.startIndex >= position.character) break;
        if (this.isCommentToken(token) || token.scopes.some((scope) => scope.startsWith("string."))) continue;
        const text = this.getRawTokenContent(lines[lineIndex], token).trim();
        if (!text) continue;
        if (token.scopes.includes(LanguageScopes.functionIdentifier) && token.scopes.includes(LanguageScopes.functionCall)) {
          identifier = text;
          continue;
        }
        if (text === "(" || text === "[") calls.push({ identifier: text === "(" ? identifier : undefined, activeParameter: 0 });
        else if (text === ")" || text === "]") calls.pop();
        else if (text === "," && calls.length) calls[calls.length - 1].activeParameter++;
        identifier = undefined;
      }
    }
    return calls.reverse().find((call) => call.identifier !== undefined);
  }

  public async loadGrammar() {
    this.grammar = await this.registry.loadGrammar("source.nss");

    return this;
  }

  private requireTokens(tokensArrays: (IToken[] | undefined)[], lineIndex: number) {
    const tokens = tokensArrays[lineIndex];
    if (!tokens) throw new Error(`Missing tokens at line ${lineIndex + 1}`);
    return tokens;
  }

  private getTokenIndexAtPosition(tokensArray: IToken[], position: Position) {
    return tokensArray.findIndex((token) => token.startIndex <= position.character && token.endIndex >= position.character);
  }

  private getRawTokenContent(line: string, token: IToken) {
    return line.slice(token.startIndex, token.endIndex);
  }

  private isCommentToken(token: IToken) {
    return token.scopes.some((scope) => scope.startsWith("comment."));
  }

  private getIncludeName(line: string, tokens: IToken[]) {
    const includeTokens = tokens.filter((token) => token.scopes.includes(LanguageScopes.includeString) && !this.isCommentToken(token));
    const opening = includeTokens.find((token) => token.scopes.includes(LanguageScopes.stringBegin));
    const closing = includeTokens.find((token) => token.scopes.includes(LanguageScopes.stringEnd));
    if (!opening || !closing) return;
    return line.slice(opening.endIndex, closing.startIndex) || undefined;
  }

  private getIncludeInsertionPosition(lines: string[], tokensArrays: (IToken[] | undefined)[]): Position {
    let headerEnd: Position = { line: 0, character: 0 };
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      for (const token of tokensArrays[lineIndex] || []) {
        if (!this.getRawTokenContent(line, token).trim()) continue;
        if (!this.isCommentToken(token) && !token.scopes.includes(LanguageScopes.includeDeclaration)) {
          // A closing block comment can share a line with the first declaration.
          return headerEnd.character === 0 || headerEnd.line === lineIndex ? headerEnd : { line: headerEnd.line + 1, character: 0 };
        }
        headerEnd = { line: lineIndex, character: Math.min(line.length, token.endIndex) };
      }
    }
    return headerEnd.character > 0 && headerEnd.line + 1 < lines.length ? { line: headerEnd.line + 1, character: 0 } : headerEnd;
  }

  private getTokenIndex(tokensArray: IToken[], targetToken: IToken) {
    return tokensArray.findIndex((token) => token.startIndex === targetToken.startIndex);
  }

  private getPrecedingType(lines: string[], tokensArrays: (IToken[] | undefined)[], lineIndex: number, tokenIndex: number) {
    for (let line = lineIndex; line >= 0; line--) {
      const tokens = this.requireTokens(tokensArrays, line);
      for (let index = line === lineIndex ? tokenIndex - 1 : tokens.length - 1; index >= 0; index--) {
        const token = tokens[index];
        const text = this.getRawTokenContent(lines[line], token).trim();
        if (!text || this.isCommentToken(token)) continue;
        // The nearest meaningful token is the builtin type or the struct tag.
        // Whitespace and comments may span lines in valid signatures.
        return text as LanguageTypes;
      }
    }
    throw new Error("Missing declaration type");
  }

  private *functionSignature(lineIndex: number, tokenIndex: number, tokensArrays: (IToken[] | undefined)[]) {
    for (; ; lineIndex++, tokenIndex = 0) {
      const tokens = this.requireTokens(tokensArrays, lineIndex).slice(tokenIndex);
      const end = tokens.findIndex((token) => token.scopes.includes(LanguageScopes.rightParametersRoundBracket));
      yield { lineIndex, nextTokenIndex: end < 0 ? tokenIndex + tokens.length : tokenIndex + end + 1, tokens: end < 0 ? tokens : tokens.slice(0, end + 1) };
      if (end >= 0) return;
    }
  }

  private getFunctionParams(lineIndex: number, tokenIndex: number, lines: string[], tokensArrays: (IToken[] | undefined)[]) {
    const params: FunctionParamComplexToken[] = [];
    let signatureEnd: Position = { line: lineIndex, character: 0 };
    for (const part of this.functionSignature(lineIndex, tokenIndex, tokensArrays)) {
      signatureEnd = { line: part.lineIndex, character: part.tokens[part.tokens.length - 1].endIndex };
      for (const token of part.tokens) {
        if (!token.scopes.includes(LanguageScopes.functionParameters) || !token.scopes.includes(LanguageScopes.type)) continue;
        const index = this.getTokenIndex(this.requireTokens(tokensArrays, part.lineIndex), token);
        for (const declaration of this.getVariableDeclarations(lines, tokensArrays, part.lineIndex, index)) {
          params.push({
            position: declaration.position,
            identifier: declaration.identifier,
            tokenType: CompletionItemKind.TypeParameter,
            valueType: declaration.valueType,
            defaultValue: declaration.value || undefined,
          });
        }
      }
    }
    return { params, signatureEnd };
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

  private isFunctionDeclaration(lineIndex: number, tokenIndex: number, tokensArrays: (IToken[] | undefined)[]) {
    for (const part of this.functionSignature(lineIndex, tokenIndex, tokensArrays)) {
      lineIndex = part.lineIndex;
      tokenIndex = part.nextTokenIndex;
    }
    for (; lineIndex < tokensArrays.length; lineIndex++, tokenIndex = 0) {
      for (const token of this.requireTokens(tokensArrays, lineIndex).slice(tokenIndex)) {
        if (token.scopes.includes(LanguageScopes.terminatorStatement)) return true;
        if (token.scopes.includes(LanguageScopes.blockDeclaraction)) return false;
      }
    }
    return false;
  }

  private isFunctionIdentifier(lineIndex: number, tokenIndex: number, token: IToken) {
    return !(tokenIndex === 0 && lineIndex === 0) && !token.scopes.includes(LanguageScopes.block) && token.scopes.includes(LanguageScopes.functionIdentifier);
  }

  private getFunctionToken(lineIndex: number, tokenIndex: number, token: IToken, lines: string[], tokensArrays: (IToken[] | undefined)[]): FunctionComplexToken {
    return {
      position: { line: lineIndex, character: token.startIndex },
      identifier: this.getRawTokenContent(lines[lineIndex], token),
      tokenType: CompletionItemKind.Function,
      returnType: this.getPrecedingType(lines, tokensArrays, lineIndex, tokenIndex),
      ...this.getFunctionParams(lineIndex, tokenIndex, lines, tokensArrays),
      comments: this.getFunctionComments(lines, tokensArrays, tokenIndex === 0 ? lineIndex - 2 : lineIndex - 1),
    };
  }

  private *declarationTokens(lines: string[], tokensArrays: (IToken[] | undefined)[], lineIndex: number, tokenIndex: number) {
    for (; lineIndex < lines.length; lineIndex++, tokenIndex = 0) {
      const tokens = tokensArrays[lineIndex] || [];
      for (; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex];
        const text = this.getRawTokenContent(lines[lineIndex], token).trim();
        if (!this.isCommentToken(token) && text) yield { token, text, lineIndex };
      }
    }
  }

  private isStructDeclaration(token: IToken, lineIndex: number, tokenIndex: number, lines: string[], tokensArrays: (IToken[] | undefined)[]) {
    if (!token.scopes.includes(LanguageScopes.structIdentifier) || token.scopes.includes(LanguageScopes.block)) return false;
    const next = this.declarationTokens(lines, tokensArrays, lineIndex, tokenIndex + 1).next().value;
    return next?.token.scopes.includes(LanguageScopes.blockDeclaraction) || false;
  }

  private isVariableIdentifier(token: IToken) {
    // Uppercase variable names receive the grammar's constant highlighting.
    return token.scopes.includes(LanguageScopes.variableIdentifer) || token.scopes.includes(LanguageScopes.constantIdentifer);
  }

  private getVariableDeclarations(lines: string[], tokensArrays: (IToken[] | undefined)[], lineIndex: number, tokenIndex: number, strict = false) {
    const stream = this.declarationTokens(lines, tokensArrays, lineIndex, tokenIndex);
    let type = stream.next().value?.text;
    if (type === LanguageTypes.struct) {
      const name = stream.next().value;
      if (!name?.token.scopes.includes(LanguageScopes.structIdentifier)) return [];
      type = name.text;
    }
    const declarations: { identifier: string; position: Position; valueType: LanguageTypes; value: string }[] = [];
    let expectingName = true;
    let depth = 0;
    let valueStart: Position | undefined;
    const finishValue = (line: number, character: number) => {
      if (!valueStart || !declarations.length) return;
      const start = valueStart;
      declarations[declarations.length - 1].value = lines
        .slice(start.line, line + 1)
        .map((text, index) => text.slice(index === 0 ? start.character : 0, index === line - start.line ? character : undefined))
        .join("\n")
        .trim();
      valueStart = undefined;
    };
    for (const part of stream) {
      const { token, text, lineIndex: line } = part;
      const stringToken = token.scopes.some((scope) => scope.startsWith("string."));
      if (expectingName) {
        if (!this.isVariableIdentifier(token) && !token.scopes.includes(LanguageScopes.functionParameter)) {
          if (strict) throw new Error("Incomplete variable declaration");
          return declarations;
        }
        declarations.push({ identifier: text, position: { line, character: token.startIndex }, valueType: type as LanguageTypes, value: "" });
        expectingName = false;
      } else if (!stringToken) {
        if (text === "(" || text === "[") depth++;
        else if (text === ")" || text === "]") {
          if (depth === 0) {
            finishValue(line, token.startIndex);
            return declarations;
          }
          depth--;
        } else if (depth === 0 && (text === ";" || text === "," || text === "}")) {
          finishValue(line, token.startIndex);
          if (text !== ",") return declarations;
          expectingName = true;
        } else if (depth === 0 && text === "=") {
          valueStart = { line, character: token.endIndex };
        } else if (depth === 0 && token.scopes.includes(LanguageScopes.type)) {
          // Resume from the next declaration when live text is unfinished.
          if (strict) throw new Error("Incomplete variable declaration");
          return declarations;
        }
      }
    }
    if (strict && expectingName) throw new Error("Incomplete variable declaration");
    return declarations;
  }

  private tokenizeDocumentLines(lines: string[], tokensArrays: (IToken[] | undefined)[], startIndex: number = 0, stopIndex: number = -1, allowIncomplete = false) {
    const firstLineIndex = startIndex > lines.length || startIndex < 0 ? 0 : startIndex;
    const lastLineIndex = stopIndex + 10 > lines.length || stopIndex < 0 ? lines.length : stopIndex;
    const scope: DocumentTokenizationResult = {
      globalDeclarations: [],
      structDeclarations: [],
      children: [],
    };

    let currentStruct: StructComplexToken | null = null;
    let followsDot = false;
    for (let lineIndex = firstLineIndex; lineIndex < lastLineIndex; lineIndex++) {
      const line = lines[lineIndex];
      const tokensArray = tokensArrays[lineIndex];

      if (tokensArray) {
        try {
          for (let tokenIndex = 0; tokenIndex < tokensArray.length; tokenIndex++) {
            const token = tokensArray[tokenIndex];
            const text = this.getRawTokenContent(line, token).trim();
            if (this.isCommentToken(token) || !text) continue;
            if (followsDot && (this.isVariableIdentifier(token) || token.scopes.includes(LanguageScopes.structProperty))) {
              (scope.memberReferences ||= []).push({ identifier: text, position: { line: lineIndex, character: token.startIndex }, tokenType: CompletionItemKind.Reference });
            }
            followsDot = token.scopes.includes(LanguageScopes.dotAccessStatement);

            if (currentStruct) {
              if (token.scopes.includes(LanguageScopes.blockTermination)) {
                scope.structDeclarations.push(currentStruct);
                currentStruct = null;
              } else if (token.scopes.includes(LanguageScopes.type)) {
                for (const { identifier, position, valueType } of this.getVariableDeclarations(lines, tokensArrays, lineIndex, tokenIndex, !allowIncomplete)) {
                  currentStruct.properties.push({ identifier, position, valueType, tokenType: CompletionItemKind.Property });
                }
              }
              continue;
            }

            if (token.scopes.includes(LanguageScopes.includeDeclaration)) {
              const name = this.getIncludeName(line, tokensArray);
              if (name) {
                scope.children.push(name);
                (scope.includePositions ||= []).push({ line: lineIndex, character: token.startIndex });
              }
              break;
            }

            if (token.scopes.includes(LanguageScopes.type) && !token.scopes.includes(LanguageScopes.block) && !token.scopes.includes(LanguageScopes.functionDeclaration)) {
              let previous: string | undefined;
              for (
                let previousLine = lineIndex, previousIndex = tokenIndex - 1;
                previousLine >= 0 && previous === undefined;
                previousLine--, previousIndex = (tokensArrays[previousLine]?.length || 0) - 1
              ) {
                const previousTokens = tokensArrays[previousLine] || [];
                for (; previousIndex >= 0; previousIndex--) {
                  const candidate = previousTokens[previousIndex];
                  const text = this.getRawTokenContent(lines[previousLine], candidate).trim();
                  if (!this.isCommentToken(candidate) && text) {
                    previous = text;
                    break;
                  }
                }
              }
              for (const declaration of this.getVariableDeclarations(lines, tokensArrays, lineIndex, tokenIndex)) {
                scope.globalDeclarations.push({
                  position: declaration.position,
                  identifier: declaration.identifier,
                  tokenType: CompletionItemKind.Constant,
                  valueType: declaration.valueType,
                  value: declaration.value,
                  ...(previous === "const" ? { isConst: true as const } : {}),
                });
              }
            }

            if (token.scopes.includes(LanguageScopes.type) && token.scopes.includes(LanguageScopes.block) && !token.scopes.includes(LanguageScopes.functionParameters)) {
              for (const { identifier, position, valueType } of this.getVariableDeclarations(lines, tokensArrays, lineIndex, tokenIndex)) {
                (scope.localDeclarations ||= []).push({ identifier, position, valueType, tokenType: CompletionItemKind.Variable });
              }
            }

            if (this.isFunctionIdentifier(lineIndex, tokenIndex, token)) {
              const implementation = !this.isFunctionDeclaration(lineIndex, tokenIndex, tokensArrays);
              const identifier = this.getRawTokenContent(line, token);
              const functionToken = this.getFunctionToken(lineIndex, tokenIndex, token, lines, tokensArrays);
              if (implementation && (identifier === "main" || identifier === "StartingConditional")) {
                (scope.entryPointDeclarations ||= []).push({ ...functionToken, implementation: true });
                continue;
              }
              if (implementation) functionToken.implementation = true;
              const existing = scope.globalDeclarations.find(
                (candidate): candidate is FunctionComplexToken => candidate.tokenType === CompletionItemKind.Function && candidate.identifier === identifier,
              );
              if (!existing) scope.globalDeclarations.push(functionToken);
              else {
                // Keep names from subsequent signatures too: an implementation
                // can use different parameter names from its prototype.
                if (functionToken.params.length) (scope.localDeclarations ||= []).push(...functionToken.params);
                if (implementation) existing.implementation = true;
              }
              continue;
            }

            if (this.isStructDeclaration(token, lineIndex, tokenIndex, lines, tokensArrays)) {
              currentStruct = {
                position: { line: lineIndex, character: token.startIndex },
                identifier: this.getRawTokenContent(line, token),
                tokenType: CompletionItemKind.Struct,
                properties: [],
              };
              continue;
            }
          }
        } catch (error) {
          if (!allowIncomplete) throw error;
          // Live text can end between any two tokens of a declaration. Retain
          // completed declarations and resume at the next line. Strict indexing
          // still reports the failure so its last usable snapshot is preserved.
        }
      }
    }

    return scope;
  }

  private tokenizeLinesForLocalScope(lines: string[], tokensArrays: (IToken[] | undefined)[], startIndex = 0, stopIndex = -1, character = Number.POSITIVE_INFINITY) {
    const allFunctions = stopIndex < 0;
    const lastLine = allFunctions ? lines.length - 1 : Math.min(stopIndex, lines.length - 1);
    const scope: LocalScopeTokenizationResult = { functionsComplexTokens: [], functionVariablesComplexTokens: [] };
    const frames: LocalScopeTokenizationResult["functionVariablesComplexTokens"][] = [];
    let pendingFunction: FunctionComplexToken | undefined;
    let activeFunction: FunctionComplexToken | undefined;
    const beforeCursor = (position: Position) => position.line < lastLine || (position.line === lastLine && position.character <= character);
    const nearestFirst = <T extends { position: Position }>(tokens: T[]) =>
      tokens.sort((left, right) => right.position.line - left.position.line || left.position.character - right.position.character);

    for (let lineIndex = Math.max(0, startIndex); lineIndex <= lastLine; lineIndex++) {
      const tokens = tokensArrays[lineIndex] || [];
      for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex];
        if (lineIndex === lastLine && token.startIndex >= character) break;
        if (this.isCommentToken(token)) continue;
        if (token.scopes.includes(LanguageScopes.blockDeclaraction)) {
          if (!frames.length && pendingFunction) {
            activeFunction = pendingFunction;
            pendingFunction = undefined;
            // Body locals can shadow parameters, including on the signature's line.
            frames.push([]);
          } else frames.push([]);
        } else if (token.scopes.includes(LanguageScopes.blockTermination)) {
          frames.pop();
          if (!frames.length) activeFunction = undefined;
        } else if (!frames.length && token.scopes.includes(LanguageScopes.terminatorStatement)) {
          pendingFunction = undefined;
        } else if (this.isFunctionIdentifier(lineIndex, tokenIndex, token)) {
          try {
            pendingFunction = { ...this.getFunctionToken(lineIndex, tokenIndex, token, lines, tokensArrays), variables: [] };
            if (!this.isFunctionDeclaration(lineIndex, tokenIndex, tokensArrays)) {
              scope.functionsComplexTokens.push(pendingFunction);
            }
          } catch {
            // An unfinished signature must not discard prior declarations.
          }
        } else if (activeFunction && frames.length && token.scopes.includes(LanguageScopes.type) && !token.scopes.includes(LanguageScopes.functionParameters)) {
          const variables = this.getVariableDeclarations(lines, tokensArrays, lineIndex, tokenIndex)
            .filter((declaration) => beforeCursor(declaration.position))
            .map(({ identifier, position, valueType }): VariableComplexToken => ({ identifier, position, valueType, tokenType: CompletionItemKind.Variable }));
          frames[frames.length - 1].push(...variables);
          activeFunction.variables?.push(...variables);
        }
      }
    }
    scope.functionsComplexTokens.reverse();
    for (const fn of scope.functionsComplexTokens) if (fn.variables) nearestFirst(fn.variables);
    scope.functionVariablesComplexTokens = allFunctions
      ? scope.functionsComplexTokens.flatMap((fn) => [...(fn.variables || []), ...fn.params])
      : frames
          .slice()
          .reverse()
          .flatMap((variables) => nearestFirst(variables))
          .concat((activeFunction || pendingFunction)?.params.filter((param) => beforeCursor(param.position)) || []);
    return scope;
  }
}
