# NWScript conformance and recovery audit

The target is the bundled official compiler from neverwinter.nim 2.3.1, revision `369fdc4186f19d3668f05b44f9b98d32ea5233c4`. The review used its native [`scriptcomplexical.cpp`](https://github.com/niv/neverwinter.nim/blob/369fdc4186f19d3668f05b44f9b98d32ea5233c4/neverwinter/nwscript/native/scriptcomplexical.cpp) and [`scriptcompparsetree.cpp`](https://github.com/niv/neverwinter.nim/blob/369fdc4186f19d3668f05b44f9b98d32ea5233c4/neverwinter/nwscript/native/scriptcompparsetree.cpp), plus executable probes. Compiler provenance and platform builds are documented in `server/resources/compiler/README.md`.

## Committed checks

`conformance.json` contains 111 explicit source cases and two independent expectations: whether the syntax tree contains errors and the compiler outcome. Tests invoke the bundled compiler with the checked-in `compiler-language.nss` specification (the eight engine types and API constants needed by these cases) and check both the exit status and compilation summary. The include-at-EOF case explicitly records the compiler's **skipped** outcome; it is not counted as a successful compilation.

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

A deterministic edit sweep checks 805 delete/insert/restore sequences through valid code, interrupted declarations, raw strings, comments, Unicode, and CRLF. Incremental trees, indexes, scopes, call contexts, member paths, and action targets match fresh parsing at three positions after each edit.

Committed tests cover void/primitive/struct returns, same-line/LF/CRLF boundaries, exact declaration positions, subsequent repairs, incremental-versus-fresh parsing, and unfinished comments. A standalone LSP test verifies definition, hover, completion and signature help on the recovered function. These checks replace the previous test that documented losing `Later()`.

## Corpus and integration results

- 662 repository tests pass, including the newly installed-server recovery case.
- 161 parser checks pass, including the 111 compiler-backed cases and all 39 upstream corpus files.
- An additional local audit parses 1,186 extracted bundled scripts and 74 FRU source files without syntax errors. Those private/extracted files are not committed; these results supplement the reproducible tests.
- Comparing exported declarations (including types, parameters, defaults and source positions, excluding comments) against 3.0.1 across those 1,260 scripts found only two differences: Tree-sitter retains the prototype after a line comment ending in a backslash in `nw_i0_spells`, and correctly reads a third struct parameter in `nwnx_effect`. The source text confirms both improvements; regression tests preserve them.
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

## Comparison with the released parser

Run `yarn --cwd server/poc/tree-sitter compare /absolute/path/to/3.0.1-checkout /absolute/path/to/script.nss ...`. The baseline checkout needs its own installed dependencies. The script bundles each revision's tokenizer into its own ignored `server/out` directory and loads that revision's own grammar and runtime.

Both parsers perform the same index, local-scope, member-path and action-target work at EOF. Cold means the first request on a new document; warm repeats without changes; edit appends a space and requests again. Five iterations warm up the process and twenty supply the samples. Startup, include traversal, provider rendering and UI latency are excluded. These differ from the earlier component measurements above.

Local Node 24 / WSL Linux p95, milliseconds (3.0.1 → Tree-sitter):

| Source | Cold request | Repeated request | Request after edit |
| --- | ---: | ---: | ---: |
| `cmds_player.nss`, 286 characters | 1.91 → 0.42 | 1.31 → 0.17 | 0.51 → 0.22 |
| `nwnx_redis.nss`, 132,444 characters | 77.79 → 50.51 | 76.64 → 32.63 | 81.83 → 44.77 |
| Engine API, 680,621 characters | 466.99 → 319.96 | 462.43 → 98.78 | 459.19 → 302.87 |
| 200 interrupted declarations | 26.51 → 17.09 | 27.18 → 6.28 | 26.90 → 17.44 |

Tree-sitter was faster on the four inputs in that comparison. A separate 67-character smoke run had sub-millisecond timings with mixed results (cold p95 0.43 → 0.47 ms, warm 0.76 → 0.26 ms, edit 0.31 → 0.69 ms); small-file timings do not establish a universal speedup. Large-file cold requests and reindexing still cost hundreds of milliseconds; this is an improvement over the baseline, not a claim that all requests are instantaneous. No extra production caches or performance refactor were introduced to obtain these results.

## Current status

The branch is rebased onto `main` at `2275b80` (3.0.1, merged PR #105), with all provider fixes retained. The conformance suite initially failed in clean CI because it used an ignored local API source. It now uses a checked-in minimal language specification; all 111 compiler outcomes remain identical to the prior full-API run.

The production build and all four platform test jobs passed on `608f1f0`: Linux, Windows, Intel macOS and Apple Silicon. That revision includes the self-contained compiler fixture, the 805-edit recovery sweep, the two corpus regression tests and the comparison tooling.

Local validation: 662 repository tests, 161 parser checks, root and harness type checking/lint, production build, and byte-identical standard-library regeneration. A freshly installed standalone package also passed the headless Neovim test for initialization, diagnostics, completion, hover, definition, formatting and shutdown.

Manual Zed smoke validation passed in the FRU workspace using Windows Zed 1.19.2 over WSL and a freshly installed standalone package. A project-local server override leaves global editor settings unchanged. All 74 existing workspace scripts indexed successfully. Actual keyboard actions, UI inspection and the server protocol trace verified:

- `CommandStruct` in `cmds_player.nss` navigates to its implementation in `consts_cmds.nss`; `commandStruct` navigates to the struct declaration.
- A helper call navigates to its implementation; navigation on the prototype and implementation toggles between them.
- Hover returns engine-function documentation and parameter defaults. Signature help visibly highlights the active second parameter and displays its default.
- Auto-import acceptance inserts its include immediately below an existing include. With the argument filled in, formatting on save succeeds and compiler diagnostics clear. Clang-format sorts includes on save; this is separate from the completion insertion position.
- Ordinary completion still works before an unfinished struct field declaration. Member completion returns the correct field before an unfinished function signature.
- Typing a function name inside a raw string returns an empty server completion list and shows no suggestion popup.

Temporary QA scripts were removed afterward; the user's existing FRU source edits were left intact. FRU retains the local server override for user review. The earlier isolated Linux GUI attempt was stopped after its shared keyring service triggered desktop prompts; it is not used as evidence for the Windows smoke test.

The language/recovery audit, comparative performance investigation and editor smoke checks are complete for the stated corpus and cases. The PR remains a draft for user review. These results are not a proof of correctness for every possible malformed program or a guarantee of interactive latency on every workspace.
