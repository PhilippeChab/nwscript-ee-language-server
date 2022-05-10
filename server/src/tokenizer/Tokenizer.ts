import { join } from "path";
import { Registry, parseRawGrammar, INITIAL, ITokenizeLineResult, IGrammar, IToken } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { WorkspaceFilesSystem } from "../workspaceFiles";
import { Sign } from "crypto";
//import { connection } from "../server";

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

export default class Tokenizer {
  registry: Registry;
  grammar: IGrammar | null = null;

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

  loadGrammar = async () => {
    this.grammar = await this.registry.loadGrammar("source.nss");

    return this;
  };

  tokenizeContent = (content: string) => {
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
  };

  retrieveConstants = (tokens: Token[][]) => {
    const constants: string[] = [];

    tokens.forEach((tokensLine) => {
      tokensLine.forEach((token) => {
        if (token.meta.scopes.includes("constant.language.nss")) {
          if (!constants.includes(token.content)) {
            constants.push(token.content);
          }
        }
      });
    });

    return constants;
  };
}

/* OUTPUT:

Unknown scope name: source.js.regexp

Tokenizing line: function sayHello(name) {
 - token from 0 to 8 (function) with scopes source.js, meta.function.js, storage.type.function.js
 - token from 8 to 9 ( ) with scopes source.js, meta.function.js
 - token from 9 to 17 (sayHello) with scopes source.js, meta.function.js, entity.name.function.js
 - token from 17 to 18 (() with scopes source.js, meta.function.js, punctuation.definition.parameters.begin.js
 - token from 18 to 22 (name) with scopes source.js, meta.function.js, variable.parameter.function.js
 - token from 22 to 23 ()) with scopes source.js, meta.function.js, punctuation.definition.parameters.end.js
 - token from 23 to 24 ( ) with scopes source.js
 - token from 24 to 25 ({) with scopes source.js, punctuation.section.scope.begin.js

Tokenizing line:        return "Hello, " + name;
 - token from 0 to 1 (  ) with scopes source.js
 - token from 1 to 7 (return) with scopes source.js, keyword.control.js
 - token from 7 to 8 ( ) with scopes source.js
 - token from 8 to 9 (") with scopes source.js, string.quoted.double.js, punctuation.definition.string.begin.js
 - token from 9 to 16 (Hello, ) with scopes source.js, string.quoted.double.js
 - token from 16 to 17 (") with scopes source.js, string.quoted.double.js, punctuation.definition.string.end.js
 - token from 17 to 18 ( ) with scopes source.js
 - token from 18 to 19 (+) with scopes source.js, keyword.operator.arithmetic.js
 - token from 19 to 20 ( ) with scopes source.js
 - token from 20 to 24 (name) with scopes source.js, support.constant.dom.js
 - token from 24 to 25 (;) with scopes source.js, punctuation.terminator.statement.js

Tokenizing line: }
 - token from 0 to 1 (}) with scopes source.js, punctuation.section.scope.end.js

*/
