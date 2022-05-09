import { join } from "path";
import { Registry, parseRawGrammar, INITIAL, ITokenizeLineResult } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { WorkspaceFilesSystem } from "../workspaceFiles";
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

const registry = new Registry({
  onigLib: vscodeOnigurumaLib,
  loadGrammar: (scopeName) => {
    return new Promise((resolve, reject) => {
      if (scopeName === "source.nss") {
        return WorkspaceFilesSystem.readFileAsync(join(__dirname, "..", "..", "..", "syntaxes", "new.nwscript.tmLanguage")).then(
          (data) => resolve(parseRawGrammar((data as Buffer).toString()))
        );
      }

      reject(`Unknown scope name: ${scopeName}`);
    });
  },
});

export default async (content: string) => {
  const grammar = await registry.loadGrammar("source.nss");

  const result: ITokenizeLineResult[] = [];

  let ruleStack = INITIAL;
  for (let i = 0; i < content.length; i++) {
    const line = content[i];
    const lineTokens = grammar?.tokenizeLine(line, ruleStack);
    result[i] = lineTokens!;

    //connection.console.info(`\nTokenizing line: ${line}`);
    if (lineTokens) {
      for (let j = 0; j < lineTokens.tokens.length; j++) {
        const token = lineTokens.tokens[j];
        // connection.console.info(
        //   ` - token from ${token.startIndex} to ${token.endIndex} ` +
        //     `(${line.substring(token.startIndex, token.endIndex)}) ` +
        //     `with scopes ${token.scopes.join(", ")}`
        // );
      }

      ruleStack = lineTokens?.ruleStack;
    }
  }

  return result;
};

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
