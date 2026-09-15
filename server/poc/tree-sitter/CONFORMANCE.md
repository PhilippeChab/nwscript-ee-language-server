# NWScript conformance and recovery audit

The target is the bundled official compiler from neverwinter.nim 2.3.1, revision `369fdc4186f19d3668f05b44f9b98d32ea5233c4`. The review used its native [`scriptcomplexical.cpp`](https://github.com/niv/neverwinter.nim/blob/369fdc4186f19d3668f05b44f9b98d32ea5233c4/neverwinter/nwscript/native/scriptcomplexical.cpp) and [`scriptcompparsetree.cpp`](https://github.com/niv/neverwinter.nim/blob/369fdc4186f19d3668f05b44f9b98d32ea5233c4/neverwinter/nwscript/native/scriptcompparsetree.cpp), plus executable probes. Compiler provenance and platform builds are documented in `server/resources/compiler/README.md`.

## Committed checks

`conformance.json` contains 111 explicit source cases and two independent expectations: whether the syntax tree contains errors and the compiler outcome. Tests invoke the bundled compiler with its real language specification and check both the exit status and compilation summary. The include-at-EOF case explicitly records the compiler's **skipped** outcome; it is not counted as a successful compilation.

| Area | Cases examined and resulting grammar rules |
| --- | --- |
| Declarations | Primitive, engine and struct types; constants and comma-separated declarations; prototypes, implementations, named parameters/defaults, and struct fields. Bare struct type names, parenthesized declarations, unnamed/void parameters, nested definitions, bitfields, and aggregate initializers are rejected. |
| Numbers | Decimal and radix literals, uppercase radix prefixes, empty radix prefixes accepted by the native lexer, leading/trailing decimal points, and the lowercase `f` suffix. No C integer suffixes, digit separators, or exponent notation. Signs remain operators. |
| Vectors | Zero through three components, float forms, and symbolic constants. Component type and constant-value checks remain semantic compiler checks. |
| Strings/comments | Ordinary, raw and hashed strings; raw doubled quotes; unknown escapes accepted by the native lexer; newline behavior; adjacent C strings rejected. Unterminated comments preserve editor context. |
| Expressions | Binary and unary operators, updates, ternaries, member chains, function calls, and assignments. Assignment can appear in conditions/returns or inside parentheses; its right operand is a conditional expression, so bare assignment chains and assignments in unparenthesized ternary arms are rejected. |
| Statements | Blocks, empty statements, if/else, while/do/for, switch labels/fallthrough, return, break and continue. C-style declaration initializers in `for` and comma operators are rejected by the target compiler. |
| Directives | Includes and the engine API's `ENGINE_*` definitions. General C preprocessing and nwnsc-only directives are not treated as NWScript syntax. |

The inherited C-derived productions and dead rules were removed. This keeps one grammar for the language the server's compiler actually validates. Existing upstream fixtures continue to exercise both valid programs and semantic failures.

Syntax-clean is deliberately separate from compiler success: duplicate names, unknown identifiers, type mismatches, loop-context restrictions, and vector component types need semantic information. Expression statements are also retained at file scope to provide lexical context while a user is typing; that does not make them valid top-level program declarations.

## Recovery

Tree-sitter sometimes attaches the next function's signature/body to an earlier unfinished parameter list. `recoverDeclarations` only considers type nodes/keywords inside such a damaged signature and accepts a new boundary only if the same grammar independently parses a complete declaration there. It masks the damaged prefix in the parser input, preserving UTF-16 offsets and line endings and retaining an error marker. It never changes the source document or manufactures symbol tokens.

The repaired tree supplies every provider. Strict indexing still fails and keeps its existing fallback behavior. An edit after this exceptional recovery starts from a fresh tree, avoiding reuse of a tree whose parser input was masked; ordinary edits remain incremental.

Committed tests cover void/primitive/struct returns, same-line/LF/CRLF boundaries, exact declaration positions, subsequent repairs, incremental-versus-fresh parsing, and unfinished comments. A standalone LSP test verifies definition, hover, completion and signature help on the recovered function. These checks replace the previous test that documented losing `Later()`.

## Corpus and integration results

- 617 repository tests pass, including the newly installed-server recovery case.
- 158 parser checks pass, including the 111 compiler-backed cases and all 39 upstream corpus files.
- An additional local audit parses 1,186 extracted bundled scripts and 74 FRU source files without syntax errors. Those private/extracted files are not committed; these results supplement the reproducible tests.
- Regenerating the standard library matches the shipped JSON byte for byte.
- The hashed grammar source files have explicit LF checkout attributes, fixing the Windows manifest mismatch without disabling its assertion.

## Timing probe

Run `yarn --cwd server/poc/tree-sitter benchmark /absolute/path/to/script.nss` to reproduce the probe.

Local Node 24/WASM measurements used five warm-up iterations and 30 measured iterations. Each iteration created and indexed a document, appended a newline and reindexed it, then requested local scope, action target, and call context at EOF. These are component measurements, not end-to-end editor latency or comparisons with the old parser.

| Input | Parse + index p95 | Edit + index p95 | Three context queries p95 |
| --- | ---: | ---: | ---: |
| 132,444-character FRU `nwnx_redis.nss` | 17.84 ms | 14.39 ms | 39.16 ms |
| 680,621-character engine API | 100.30 ms | 87.62 ms | 94.43 ms |
| 200 damaged signatures (12,180 characters) | 11.05 ms | 10.84 ms | 6.30 ms |

Large-file index extraction and context scans remain measurable work. This audit supports the parser migration for the tested language and editor behavior; it does not establish a universal latency guarantee or exhaustive correctness for every malformed input.

## Checkpoint and remaining work

Checkpoint on `poc/tree-sitter-tokenizer` for draft PR #104. The production tokenizer uses Tree-sitter, the narrowed grammar and interrupted-signature recovery are implemented, and the rebuilt WASM and its provenance manifest are included. Existing semantic resolution and compiler validation remain separate from syntax parsing.

Local validation completed: 617 repository tests, 158 parser checks, TypeScript compilation, parser harness type checking, root and harness lint, production build, and byte-for-byte standard-library regeneration. The benchmark harness is included so the timing probe can be repeated.

Before taking the PR out of draft:

- Rerun platform CI on this checkpoint, especially Windows. The prior Windows run exposed CRLF conversion of hashed grammar sources; this checkpoint adds LF checkout attributes, but a new Windows CI result is still required.
- Repeat Neovim integration and manual Zed checks against a newly packaged build. Those editor checks were not repeated for this checkpoint; the current standalone server tests do pass.
- Review large-file indexing/context-query costs and the exceptional recovery path. The measurements above are local component timings, not a comparison against the previous parser or an editor latency guarantee.

This checkpoint has not been installed in the user's editor or released. It records completed work and the remaining verification; it is not a merge-readiness claim.
