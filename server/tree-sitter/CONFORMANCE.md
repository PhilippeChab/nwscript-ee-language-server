# NWScript conformance tests

The grammar targets the [bundled NWScript compiler](../resources/compiler/README.md). Compiler version and source provenance are recorded there.

## Fixtures

[`conformance.json`](conformance.json) records source examples with separate expectations for syntax-tree errors and compiler outcomes. Tests run the bundled compiler with [`compiler-language.nss`](compiler-language.nss), a minimal language specification containing the engine types and constants needed by the cases. No game installation or downloaded API source is required.

Cases cover declarations, literals, strings, comments, expressions, statements and directives. Compiler rejection and skipped compilation are distinct outcomes; a skipped file does not count as a successful compilation.

Run the checks from the repository root after installing the project dependencies:

```sh
yarn --cwd server/tree-sitter install --frozen-lockfile
yarn --cwd server/tree-sitter test
```

## Syntax and semantics

A syntax-clean tree does not establish that a program compiles. Name resolution, type compatibility, duplicate declarations and control-flow restrictions remain compiler checks. The grammar also accepts some incomplete or misplaced expressions to preserve editor context while typing.

When changing the grammar, add fixtures for both accepted and rejected forms and verify their compiler outcomes. Keep syntax expectations separate from semantic validity.

## Recovery

Tests compare incremental parsing with fresh parsing after damaged edits and restoration, including unfinished declarations, comments, raw strings, Unicode and CRLF. They check declaration positions and provider context as well as tree shape.

The grammar represents unfinished signatures as `incomplete_function_definition` nodes, leaving following declarations separate. Complete declarations take priority over unfinished parameter lists. These nodes preserve the original text and offsets, participate in incremental parsing, and never enter the declaration index.

`Syntax.hasSyntaxErrors` includes both Tree-sitter errors and explicit incomplete nodes. Strict indexing rejects unfinished signatures so saved include snapshots retain their fallback behavior.
