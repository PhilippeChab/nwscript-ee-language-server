import { join } from "path";
import { Registry, parseRawGrammar, INITIAL, IGrammar, IToken } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { CompletionItem, CompletionItemKind } from "vscode-languageserver";

import { WorkspaceFilesSystem } from "../workspaceFiles";

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

type Token = { meta: IToken; content: string };

const INCLUDE_SCOPE = "meta.preprocessor.include.nss";
const FUNCTION_SCOPE = "meta.function.nss";
const BLOCK_SCOPE = "meta.block.nss";

const TERMINATOR_STATEMENT = "punctuation.terminator.statement.nss";

const CONSTANT_DECLARATION_SCOPE = "constant.language.nss";
const FUNCTION_DECLARACTION_SCOPE = "entity.name.function.nss";

export default class Tokenizer {
  private readonly registry: Registry;
  private grammar: IGrammar | null = null;

  constructor() {
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

  private tokensLineToString(tokensLine: Token[]) {
    return tokensLine.reduce((previous, current) => {
      return previous + current.content;
    }, "");
  }

  async loadGrammar() {
    this.grammar = await this.registry.loadGrammar("source.nss");

    return this;
  }

  tokenizeContent(content: string) {
    let ruleStack = INITIAL;
    let lines = content.split(/\r?\n/);

    return lines.map((line) => {
      const lineTokens = this.grammar?.tokenizeLine(line, ruleStack);

      if (lineTokens) {
        ruleStack = lineTokens.ruleStack;
        return lineTokens.tokens.map((token) => {
          return { meta: token, content: line.substring(token.startIndex, token.endIndex) };
        });
      } else {
        return [];
      }
    });
  }

  retrieveGlobalDefinitions(content: string) {
    const tokens: Token[][] = this.tokenizeContent(content);
    const definitions: { items: CompletionItem[]; children: string[] } = { items: [], children: [] };

    tokens.forEach((tokensLine) => {
      for (let index = 0; index < tokensLine.length; index++) {
        const token = tokensLine[index];

        // CHILD
        if (token.meta.scopes.includes(INCLUDE_SCOPE)) {
          definitions.children.push(tokensLine.at(-2)?.content!);
          break;
        }

        // CONSTANT
        if (
          token.meta.scopes.includes(CONSTANT_DECLARATION_SCOPE) &&
          !token.meta.scopes.includes(FUNCTION_SCOPE) &&
          !token.meta.scopes.includes(BLOCK_SCOPE)
        ) {
          definitions.items.push({
            label: token.content,
            kind: CompletionItemKind.Constant,
            detail: `(constant) ${this.tokensLineToString(tokensLine)}`,
          });
          break;
        }

        // FUNCTION
        if (
          token.meta.scopes.includes(FUNCTION_DECLARACTION_SCOPE) &&
          tokensLine[tokensLine.length - 1].meta.scopes.includes(TERMINATOR_STATEMENT) &&
          !token.meta.scopes.includes(BLOCK_SCOPE)
        ) {
          definitions.items.push({
            label: token.content,
            kind: CompletionItemKind.Function,
            detail: `(method) ${this.tokensLineToString(tokensLine)}`,
          });
          break;
        }
      }
    });

    return definitions;
  }
}
