# Tree-sitter parser

The server uses Tree-sitter to parse NWScript. Completion, hover, definition, signature help, workspace indexing, and the installed standalone server use the new implementation.

The existing include graph, symbol/type resolution, declaration-order and namespace checks, auto-import edits, and compiler diagnostics stay in their existing classes. VS Code keeps its TextMate grammar for highlighting.

## Architecture

`ParserService` initializes the parser and caches syntax documents by live document version. `SyntaxDocument` wraps a syntax tree and exposes declarations and cursor context. An open buffer's `IndexedDocument` references that syntax document and adds include/dependency lookup; `Declaration` describes a declaration without introducing symbol bindings. Declarations and references use `kind` as their discriminator in both code and serialized indexes.

Providers obtain a parsed document from the collection:

```ts
const document = this.server.documentsCollection.getParsedDocument(liveDocument, this.server.parserService);
const declarations = document.getGlobalDeclarations(); // Includes dependencies.
const locals = document.syntax?.getLocalScope(position);
const call = document.syntax?.getCallContext(position);
```

The collection reuses the same parsed `IndexedDocument` for the lifetime of a live `TextDocument`. The parser updates its tree incrementally after edits. Declarations and include entries (`{ name, position }`) come directly from the syntax document's cached `DocumentIndex`. Include traversal normalizes resource names and skips the implicit `nwscript` dependency. Derived type references refresh when the index changes. Reopening a file creates a separate live document, even if its URI and version match the closed buffer.

Bundled definitions and background indexing use index-only documents without retaining syntax trees. Include lookup keeps the last usable index independently of the live document, so unfinished edits cannot overwrite its fallback snapshot. Live requests read the recovered current syntax. Unused live trees release their WASM resources through finalization, while one-shot indexing explicitly disposes them.

Call and member context scan syntax leaves where needed to preserve incomplete-expression behavior. Strict background indexing still rejects incomplete declarations so existing fallback snapshots and repair behavior remain intact; live requests use the recovered tree.

## Run and inspect

Use Node.js 24 and Yarn Classic 1.22.22:

```sh
yarn install --frozen-lockfile
yarn compile
yarn lint
yarn --cwd server check-standard-lib
yarn test

yarn --cwd server/tree-sitter install --frozen-lockfile
yarn --cwd server/tree-sitter typecheck
yarn --cwd server/tree-sitter lint
yarn --cwd server/tree-sitter test

yarn --cwd server/tree-sitter inspect --tree ../test/static/neverwinter/corpus/functions.nss
```

The inspector uses the same production parser and prints its index, syntax-error status, and optionally its tree. You can pass any absolute `.nss` path. `yarn package:standalone` builds an installable server using Tree-sitter; the standalone tests package and install it automatically.

## Validation

CI runs parser and language-server tests on Linux, Windows, Intel macOS and Apple Silicon. Coverage includes compiler-backed fixtures, incomplete declarations, scopes, Unicode/CRLF positions, incremental edits against fresh parses, and grammar/runtime artifact consistency. Standalone tests package and install the server before exercising its LSP interface.

## Language conformance

The [conformance guide](CONFORMANCE.md) explains the compiler-backed fixtures, the distinction between syntax and semantic validity, and recovery checks. Grammar changes should include cases verified against the bundled compiler.

The packaged server includes both the WebAssembly parsing runtime (`web-tree-sitter.wasm`) and the generated NWScript grammar (`tree-sitter-nwscript.wasm`). The `web-tree-sitter` package connects them to Node.js; parsing runs locally without a browser or network service. Editor syntax highlighting remains separate.

Related investigation: [#88](https://github.com/PhilippeChab/nwscript-ee-language-server/issues/88).

## Grammar provenance and rebuilding

`grammar/grammar.js` derives from the MIT-licensed [nwn-rs/tree-sitter-nwscript](https://github.com/nwn-rs/tree-sitter-nwscript/tree/b259972ec572a4068b7772e7b1768333f0a58e84), revision `b259972ec572a4068b7772e7b1768333f0a58e84`. Its license is retained in the grammar directory and shipped beside the generated grammar WASM.

The grammar has been narrowed to the bundled compiler's NWScript syntax, including its literal forms, assignment rules, declaration forms, and engine API directives. Reserved type keywords prevent incomplete declarations from treating the following type keyword as a field name. This uses Tree-sitter ABI 15. Hashed source files use LF checkout attributes on all platforms.

To rebuild with Tree-sitter CLI 0.25.10 and Docker (`emscripten/emsdk:4.0.4`):

```sh
cd server/tree-sitter/grammar
npx --yes tree-sitter-cli@0.25.10 generate --abi 15
npx --yes tree-sitter-cli@0.25.10 build --wasm --docker --output ../../resources/tree-sitter-nwscript.wasm
cd ..
yarn grammar:record
yarn test
```

Generated C/JSON tables are ignored. `grammar/build.json` records tool versions and source/artifact hashes; updating the manifest alone is not proof of regeneration. The runtime WASM is copied from the pinned `web-tree-sitter@0.25.10` dependency into `server/resources/web-tree-sitter.wasm`, with its license. Tests compare those runtime bytes. Both WASM files ship in the VSIX and standalone package.

The adapter follows this repository's GPL-3.0-only license. The upstream grammar and Tree-sitter runtime retain their MIT licenses.
