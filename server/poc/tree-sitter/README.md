# Tree-sitter replacement draft

This branch replaces the server's TextMate-based parser with Tree-sitter. Completion, hover, definition, signature help, workspace indexing, and the installed standalone server use the new implementation. There is no alternative parser selected by a flag and no separate PoC adapter.

The existing include graph, symbol/type resolution, declaration-order and namespace checks, auto-import edits, and compiler diagnostics stay in their existing classes. VS Code keeps its TextMate grammar for highlighting.

## Concrete simplification

Compared with `main` at `85e4089`:

| Parsing code | Before | This draft |
| --- | ---: | ---: |
| Tokenizer implementation and index/context contracts | 679 lines | 516 lines across `Tokenizer`, `SyntaxDocument`, `recoverDeclarations`, and `contracts` |
| Including language constants and the old Oniguruma loader | 742 lines | 535 lines |

These counts include the new adapter and moved types, not just the remaining `Tokenizer.ts`. The production parsing code is about 28% smaller. The separately maintained Tree-sitter grammar is additional source; this is not a claim that the entire repository shrinks by that percentage.

Removed code includes TextMate rule-stack management, highlighting-scope predicates, scanning for declaration types and function-signature boundaries, variable initializer reconstruction, and manually maintained block-scope frames. Syntax nodes supply declaration kinds, types, fields, defaults, parameter lists, and enclosing blocks.

Providers now obtain one syntax document:

```ts
const syntax = this.server.tokenizer.parse(liveDocument);
const index = syntax.getIndex();
const locals = syntax.getLocalScope(position);
const call = syntax.getCallContext(position);
```

They no longer pass arrays of lines and highlighting tokens through `*FromRaw` methods. A document version shares its syntax tree and index. Updates edit that tree incrementally; a new version invalidates the derived index. Unused live trees release their WASM resources through finalization, while one-shot indexing explicitly disposes them.

Call and member context still scan syntax leaves where needed to preserve incomplete-expression behavior. The replacement does not claim that every editor operation becomes one AST lookup. Strict background indexing still rejects incomplete declarations so existing fallback snapshots and repair behavior remain intact; live requests use the recovered tree.

## Run and inspect

Use Node.js 24 and Yarn Classic 1.22.22:

```sh
yarn install --frozen-lockfile
yarn compile
yarn lint
yarn --cwd server check-standard-lib
yarn test

yarn --cwd server/poc/tree-sitter install --frozen-lockfile
yarn --cwd server/poc/tree-sitter typecheck
yarn --cwd server/poc/tree-sitter lint
yarn --cwd server/poc/tree-sitter test

yarn --cwd server/poc/tree-sitter inspect --tree ../../test/static/neverwinter/corpus/functions.nss
```

The inspector uses the same production parser and prints its index, syntax-error status, and optionally its tree. You can pass any absolute `.nss` path. `yarn package:standalone` builds an installable server using Tree-sitter; the standalone tests package and install it automatically.

## Validation

All 617 repository tests pass against the replacement, including the installed standalone LSP tests and the native compiler corpus checks. Existing test expectations are preserved. Direct parser tests now call the syntax-document API, parse-count spies observe `parseContent`, and the package license assertion names the new runtime.

The additional 158 parser checks also use the production implementation. They cover the existing index contract, incomplete declarations and strings, prototype parameters, struct fields, nested scopes and calls, Unicode/CRLF positions, incremental edits against fresh parses, document/version isolation, all 39 upstream corpus fixtures, grammar/runtime artifact consistency, and four Zed query files. Type checking and lint run for both packages. The standard-library regeneration check also matches the shipped JSON byte for byte. The headless Neovim client test passes against the packaged replacement. CI runs these checks on Windows, Linux, Intel macOS, and Apple Silicon; local validation is Linux only.

## Conformance and recovery audit

The [audit report](CONFORMANCE.md) documents the native-compiler review, 111 compiler-backed cases, real-source corpus checks, declaration recovery, and timing measurements. The inherited C-derived rules have been removed, and the earlier lost-declaration case is now covered by passing parser and installed-server regression tests.

The compiler still owns semantic validity. A syntax-clean tree does not establish correct types, names, or control flow. Exceptional recovery reparses damaged signatures; ordinary edits remain incremental. Index extraction and some context queries still scan syntax nodes, so very large files incur additional work. The audit includes those measured costs.

This branch does not install a new editor grammar or update the user's local server installation. It remains a draft for review, not a published release.

Related investigation: [#88](https://github.com/PhilippeChab/nwscript-ee-language-server/issues/88).

## Grammar provenance and rebuilding

`grammar/grammar.js` derives from the MIT-licensed [nwn-rs/tree-sitter-nwscript](https://github.com/nwn-rs/tree-sitter-nwscript/tree/b259972ec572a4068b7772e7b1768333f0a58e84), revision `b259972ec572a4068b7772e7b1768333f0a58e84`. Its license is retained in the grammar directory and shipped beside the generated grammar WASM.

The grammar has been narrowed to the bundled compiler's NWScript syntax, including its literal forms, assignment rules, declaration forms, and engine API directives. Reserved type keywords prevent incomplete declarations from treating the following type keyword as a field name. This uses Tree-sitter ABI 15. Hashed source files use LF checkout attributes on all platforms.

To rebuild with Tree-sitter CLI 0.25.10 and Docker (`emscripten/emsdk:4.0.4`):

```sh
cd server/poc/tree-sitter/grammar
npx --yes tree-sitter-cli@0.25.10 generate --abi 15
npx --yes tree-sitter-cli@0.25.10 build --wasm --docker --output ../../../resources/tree-sitter-nwscript.wasm
cd ..
yarn grammar:record
yarn test
```

Generated C/JSON tables are ignored. `grammar/build.json` records tool versions and source/artifact hashes; updating the manifest alone is not proof of regeneration. The runtime WASM is copied from the pinned `web-tree-sitter@0.25.10` dependency into `server/resources/web-tree-sitter.wasm`, with its license. Tests compare those runtime bytes. Both WASM files ship in the VSIX and standalone package.

The adapter follows this repository's GPL-3.0-only license. The upstream grammar and Tree-sitter runtime retain their MIT licenses.
