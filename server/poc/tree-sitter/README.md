# Tree-sitter tokenizer PoC

This draft evaluates replacing the language server's TextMate-derived parsing with a syntax-tree adapter. `TreeSitterDocument` returns the existing `DocumentTokenizationResult` and demonstrates local scope, member context, signature context, string/comment detection, and incremental updates. The existing completion item builder consumes its tokens in a test.

No production provider selects this backend. It is a separate package with its own development dependencies; neither the PoC nor its grammar is included in the VSIX or standalone server. The compiler and installed editor configuration are unchanged. Related investigation: [#88](https://github.com/PhilippeChab/nwscript-ee-language-server/issues/88).

## Run

Use Node.js 24 and Yarn Classic 1.22.22, as configured for this repository. From the repository root:

```sh
yarn install --frozen-lockfile
yarn --cwd server/poc/tree-sitter install --frozen-lockfile
yarn --cwd server/poc/tree-sitter typecheck
yarn --cwd server/poc/tree-sitter lint
yarn --cwd server/poc/tree-sitter test
```

Inspect a real file and compare with the current tokenizer's live recovery path:

```sh
yarn --cwd server/poc/tree-sitter inspect --compare /absolute/path/to/script.nss
```

Or use a repository fixture:

```sh
yarn --cwd server/poc/tree-sitter inspect --tree ../../test/static/neverwinter/corpus/functions.nss
```

The inspector prints the index, whether the tree contains syntax errors, and optionally the old index or concrete syntax tree. A parse without syntax errors does not establish compiler validity. CI runs the PoC checks on Windows, Linux, Intel macOS, and Apple Silicon alongside the existing suite.

## What becomes simpler

The adapter reads function/parameter/field nodes rather than reconstructing declarations from highlighting scopes. Calls are distinct from declarations, blocks provide scope boundaries, member expressions preserve their receiver, and argument-list children identify nested call context. It can retain complete declarations before a trailing parse error.

The adapter is about 250 lines, compared with the current 679-line tokenizer, but it is not yet feature-complete. This is not a claimed final line-count reduction. The grammar is maintained separately, and the generator/runtime provide parsing and recovery.

Semantic logic remains necessary: include resolution, types, visibility rules, declaration order, namespaces, entry-point conflicts, auto-import edits, and compiler diagnostics. A production migration should reuse that logic, implement the missing adapter contract, and retire the corresponding TextMate parsing code rather than permanently keeping both backends.

## Evidence and limits

The committed tests cover the existing index shape and completion builder, prototypes/implementations and parameter metadata, struct fields, initializer calls, nested scope and signature context, incomplete declarations and strings, Unicode/CRLF positions, incremental replacement of live documents, 39 existing upstream corpus fixtures, and four Zed query files.

The preceding native-parser investigation used the same grammar family on 75 FRU files and 1,186 extracted bundled sources. All parsed without syntax errors; global declaration-name sets matched the current tokenizer on those real files. Those earlier Python/native results do not replace testing this Node/WASM adapter end to end.

Known PoC limits:

- It is not wired into LSP requests. The full provider suite still runs against the production tokenizer.
- Error recovery can absorb a later declaration into an ERROR region after an early malformed signature. The test documents that behavior; the adapter does not manufacture declarations from identifiers in an ERROR node.
- The inherited grammar accepts some C-derived constructs and needs an NWScript-specific conformance audit. Semantic-negative corpus files can have valid syntax.
- Local scope and call/member methods demonstrate syntax context, not a complete name/type resolver. Import insertion and conflict detection remain in the existing shared providers/collection.
- Full document indexing is recomputed on demand. Tree edits are incremental, but this does not yet make dependency or symbol-index updates incremental.
- The Node WASM binding exposes UTF-16 indexes for string input, unlike native Tree-sitter byte offsets. Tests verify positions after non-ASCII text and edits; adapters must not apply native byte-offset conversions to this binding.
- Zed queries compile in tests, but this PR does not install a new Zed grammar. VS Code still needs its TextMate highlighting integration even if the server stops using TextMate for parsing.
- The PoC uses WASM for portable development/testing. It does not establish a production runtime or performance budget.

## Grammar provenance and rebuilding

`grammar/grammar.js` derives from the MIT-licensed [nwn-rs/tree-sitter-nwscript](https://github.com/nwn-rs/tree-sitter-nwscript/tree/b259972ec572a4068b7772e7b1768333f0a58e84), revision `b259972ec572a4068b7772e7b1768333f0a58e84`. Its license is retained in `grammar/LICENSE.txt`.

Adaptations fix comments between `if`/`else`, struct-typed fields, declarations in `for` initializers, parameter nodes/defaults, octal literals, and raw/hashed strings. Explicit string-content nodes preserve context when a closing quote is missing. The obsolete single-character uppercase expression alternative is removed. This is an adapted existing grammar, not a new parser engine.

The checked-in WASM lets every CI platform run tests without Emscripten. Generated C and JSON tables are ignored to keep the draft diff reviewable. To rebuild, use Tree-sitter CLI 0.25.10 and Docker (the CLI selects `emscripten/emsdk:4.0.4`):

```sh
cd server/poc/tree-sitter/grammar
npx --yes tree-sitter-cli@0.25.10 generate --abi 14
npx --yes tree-sitter-cli@0.25.10 build --wasm --docker --output tree-sitter-nwscript.wasm
cd ..
yarn grammar:record
yarn test
```

`grammar/build.json` records tool versions and source/artifact hashes. A test detects stale sources or artifacts relative to that manifest. Updating the manifest alone is not proof of regeneration; reviewers should regenerate after grammar changes.

The TypeScript adapter and harness follow this repository's GPL-3.0-only license; the upstream grammar retains its MIT license. Tree-sitter runtime licensing is provided by its npm package.
