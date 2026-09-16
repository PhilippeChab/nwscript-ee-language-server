Fixtures copied unchanged from [niv/neverwinter.nim](https://github.com/niv/neverwinter.nim/tree/0972fc1ffa73d1a038b9abb00dc40d5a07e28dbe/tests/scriptcomp), revision `0972fc1ffa73d1a038b9abb00dc40d5a07e28dbe`.

`corpus/` and `nwtestvmscript.nss` are upstream compiler/VM fixtures. Their MIT licence is reproduced in LICENCE. Our tests use the custom API as `nwscript.nss` in an isolated game directory, check compiler acceptance/rejection and parser robustness, and add editor-specific expectations against selected original scripts. They do not run the upstream VM or its runtime assertions. No network or Nim installation is required.

The compiler checks use the upstream default entry-point requirement, except for include-only fixtures. Separate checks exercise upstream's no-entry-point cases. CLI exit status verifies acceptance/rejection, not the numeric internal error codes in `// EXPECT:` comments.

The CLI reports missing entry points (upstream internal code 623) as skipped with exit status zero; the tests assert that skip explicitly.
