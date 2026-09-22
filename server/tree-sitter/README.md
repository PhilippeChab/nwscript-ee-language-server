# Tree-sitter parser

The server uses Tree-sitter to parse NWScript. Completion, hover, definition, signature help, workspace indexing, and the installed standalone server use the new implementation.

Include traversal and auto-import conflict checks remain in the document/index layer. The native compiler provides diagnostics, and VS Code keeps its TextMate grammar for highlighting.

## Architecture

```text
DocumentsCollection
    └── IndexedDocument
          ├── Syntax
          └── SemanticModel
```

- `DocumentsCollection` manages file identity, saved indexes, include selection, and source loading. It locates the requesting file and delegates analysis to that file's `IndexedDocument`.
- `IndexedDocument` represents one file. For an open buffer, it holds its `Syntax` and caches the `SemanticModel` derived from that syntax and its dependencies. Bundled and background files can hold only a serialized `SyntaxIndex`.
- `Syntax` wraps the Tree-sitter tree and exposes declarations, scope visibility, and cursor context. `Parser` initializes Tree-sitter, reuses parses by live document version, and updates trees incrementally.
- `SemanticModel` binds source locations to symbols and answers completion, hover, navigation, signature, and outline queries. It uses syntax queries and indexed dependencies; it does not read files or manage workspace membership.
- Providers translate semantic results into LSP responses. Formatting and compiler diagnostics use their own backends.

For example, the definition provider asks for a target and converts it to an LSP location:

```ts
const document = this.getDocument(uri);
const target = document?.semantic.getDefinitionAt(position);
if (target) return { uri: target.uri, range: { start: target.position, end: target.position } };
```

Providers fetch the file through the collection's `getDocument`, which updates its parse and calls `IndexedDocument.analyze` before returning it. The returned file exposes its current `semantic` model; there is no separate semantic cache in the collection. Each file reuses its model while the source index, ordered dependency indexes, and selected API index match. Changes replace the model and its bindings; unrelated workspace edits do not. Workspace operations supplied by the collection find auto-import candidates and read navigation targets, so the semantic model remains independent of filesystem and LSP transport details.

The collection's other entry points distinguish workspace indexing from live requests:

| Method | Purpose |
| --- | --- |
| `getWorkspaceDocument(uri)` | Read the last usable workspace index for an exact URI. |
| `getWorkspaceDocuments()` | Enumerate indexed workspace files, including duplicate basenames. |
| `getWorkspaceInclude(name)` | Find the selected workspace file for an include name. |
| `resolveInclude(name)` | Resolve an include, using bundled definitions when no workspace file is selected. |
| `addDocument(uri, index)` | Register a background index without replacing newer editor results; API snapshots retain their refresh behavior. |
| `updateDocument(document, parser, files)` | Refresh a workspace index and index missing includes. |
| `removeDocument(uri)` | Remove a workspace index and select the next duplicate or bundled include. |

Object creation, index registration, source loading, and auto-import validation are private implementation details. Live syntax remains separate from the last usable workspace index.

`IndexedDocument` exposes three properties: `syntax` (available for parsed files), `index` (available for every indexed file), and `semantic` (prepared by `getDocument`). Raw declarations and include entries live under `document.index`; the file does not repeat these fields as forwarding getters. Its public methods are grouped after these properties, with private helpers last:

| Method | Result or operation |
| --- | --- |
| `analyze(library, workspace)` | Prepare or reuse the semantic model for the current index and dependencies. |
| `getIncludeName()` | The file's normalized NWScript resource name. |
| `getEntryPointNames()` | Entry-point names declared in this file. |
| `getDependencyNames()` | Transitive include names, including unresolved includes, excluding this file. |
| `getDocumentsWithDependencies()` | This file followed by resolved dependencies in include order. |
| `getNameOrder()` | Declaration and reference positions with include order accounted for, used by import conflict checks. |

All dependency views share one private traversal with cycle detection and include-once handling. Declaration collection and cached type-reference construction are private helpers.

Bindings are computed on demand, including unresolved results. Symbols retain a declaration for presentation and group local function prototypes and implementations for navigation. Identity includes the source URI even when a bundled symbol has no navigable owner. Symbol identity is local to a semantic model, not persistent across edits or different requesting scripts. Providers reacquire the model for each request. This does not build a complete workspace reference index or type checker.

The collection reuses the same parsed `IndexedDocument` for the lifetime of a live `TextDocument`. Its `index` reads the cached `SyntaxIndex` from `Syntax`, including declarations and include entries (`{ name, position }`). Type references refresh when that index changes. Include traversal handles cycles and skips the implicit `nwscript` dependency. Reopening a file creates a separate file object, even if its URI and version match the closed buffer.

`Parser.parse(document)` manages cached live trees. `parseContent(content)` creates a caller-owned `Syntax` tree (or updates the supplied previous tree); the caller must dispose it when finished. `indexContent(content)` extracts a strict syntax index from a temporary tree and disposes it before returning. Syntax queries, including local scope, belong to `Syntax`; semantic queries belong to `SemanticModel`.

Include lookup preserves the last usable saved index independently of live syntax, so unfinished edits cannot overwrite the fallback snapshot. Unused live trees release their WASM resources through finalization; one-shot indexing and navigation parses explicitly dispose them. Call and member context scan syntax leaves where needed for incomplete expressions. Explicit incomplete-signature grammar nodes preserve following declarations while typing.

Internal `DeclarationKind` and `ReferenceKind` tags describe language data. Only presentation builders map them to LSP completion and symbol kinds.

Language analysis and its shared types live in `server/src/Language`. `Parser` manages initialization and parse caching; `IndexedDocument` owns a file's syntax and semantic model:

```text
Language/
    Parser.ts         Grammar initialization and parse caching
    Syntax.ts         Syntax-tree queries and declaration extraction
    SemanticModel.ts  Symbol binding and semantic queries
    Declarations.ts   Declared names, signatures, fields and source positions
    References.ts     Member and type references
    SyntaxIndex.ts    Serializable syntax data and import-order metadata
    TypeNames.ts      Built-in type names and user-defined struct names
    SyntaxTypes.ts    Local scopes, call context and cursor-query results
    SemanticTypes.ts  Symbols, bindings and semantic query results
    index.ts          Shared import path
```

A declaration describes source metadata. A semantic symbol connects that metadata to its source and declaration sites; a binding connects an occurrence to that symbol. A function prototype and implementation therefore belong to one symbol while retaining their separate declaration positions. Builders format declaration metadata, and providers consume typed semantic results: `resolveCall`, for example, returns a function symbol whose parameters and return type are available without another kind check.

Function navigation reads the declaration sites exposed by the symbol. Sites in the requesting file are grouped when its model is built. External sites are read on demand from the current source, preserving navigation after unsaved include edits without loading dependency syntax for hover or completion. `TypeName` permits both built-in names and custom struct names; the `BuiltinType` enum and `isBuiltinType` helper classify only the built-in names.

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

Production, standalone packaging, and bundled tests share `server/scripts/Build.ts`. The server emits CommonJS, so the build resolves Tree-sitter's published CommonJS export through Node and selects it with an [esbuild alias](https://esbuild.github.io/api/#alias). This keeps ordinary imports in the language implementation and avoids converting the dependency's ESM `import.meta.url` into CommonJS. Tree-sitter remains embedded in the release bundles; no extra runtime package installation is needed.

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

Generated C/JSON tables are ignored. `grammar/build.json` records tool versions and source/artifact hashes; updating the manifest alone is not proof of regeneration. The runtime WASM is copied from the pinned `web-tree-sitter@0.27.0` dependency into `server/resources/web-tree-sitter.wasm`, with its license. Tests compare those runtime bytes. Both WASM files ship in the VSIX and standalone package.

The adapter follows this repository's GPL-3.0-only license. The upstream grammar and Tree-sitter runtime retain their MIT licenses.
