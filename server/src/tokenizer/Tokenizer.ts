import { join } from "path";
import { Registry, parseRawGrammar, INITIAL, IGrammar, IToken } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { CompletionItem, CompletionItemKind } from "vscode-languageserver";

import { WorkspaceFilesSystem } from "../workspaceFiles";
import { Structure } from "../documents/Document";

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
const STRUCT_SCOPE = "storage.type.struct-defined.nss";
const VARIABLE_SCOPE = "variable.language.nss";
const TYPE_SCOPE = "storage.type.built-in.nss";

const TERMINATOR_STATEMENT = "punctuation.terminator.statement.nss";

const CONSTANT_DECLARATION_SCOPE = "constant.language.nss";
const FUNCTION_DECLARACTION_SCOPE = "entity.name.function.nss";
const BLOCK_DECLARACTION_SCOPE = "punctuation.section.block.begin.bracket.curly.nss";
const BLOCK_TERMINATION_SCOPE = "punctuation.section.block.end.bracket.curly.nss";

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
    const definitions: { items: CompletionItem[]; children: string[]; structures: Structure[] } = {
      items: [],
      children: [],
      structures: [],
    };

    let currentStruct: Structure | null = null;
    tokens.forEach((tokensLine) => {
      const lastIndex = tokensLine.length - 1;
      const lastToken = tokensLine[lastIndex];
      for (let index = 0; index < tokensLine.length; index++) {
        const token = tokensLine[index];

        // STRUCT PROPERTIES
        if (currentStruct) {
          if (token.meta.scopes.includes(BLOCK_TERMINATION_SCOPE)) {
            definitions.structures.push(currentStruct);
            currentStruct = null;
          } else if (!token.meta.scopes.includes(BLOCK_DECLARACTION_SCOPE)) {
            const propertyType = tokensLine.find((token) => token.meta.scopes.includes(TYPE_SCOPE))?.content;
            const property = tokensLine.find((token) => token.meta.scopes.includes(VARIABLE_SCOPE))?.content;

            if (property && propertyType) {
              currentStruct.properties[property] = propertyType;
            }
          }

          break;
        }

        // CHILD
        {
          if (token.meta.scopes.includes(INCLUDE_SCOPE)) {
            definitions.children.push(tokensLine.at(-2)?.content!);
            break;
          }
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
          lastToken.meta.scopes.includes(TERMINATOR_STATEMENT) &&
          !token.meta.scopes.includes(BLOCK_SCOPE)
        ) {
          definitions.items.push({
            label: token.content,
            kind: CompletionItemKind.Function,
            detail: `(method) ${this.tokensLineToString(tokensLine)}`,
          });
          break;
        }

        // STRUCT
        if (
          token.meta.scopes.includes(STRUCT_SCOPE) &&
          (lastToken.meta.scopes.includes(STRUCT_SCOPE) || lastToken.meta.scopes.includes(BLOCK_DECLARACTION_SCOPE))
        ) {
          currentStruct = { name: tokensLine[0].content.split(" ")[1], properties: {} };
          break;
        }
      }
    });

    return definitions;
  }
}
