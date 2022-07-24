# Change Log

All notable changes to the "nwscript-ee-language-server" extension will be documented in this file.

## [1.0.0]

- Initial release

## [1.1.0]

- New setting `autoCompleteFunctionsWithParams` which makes functions autocomplete with their complete signature. False by default.
- New setting `includeCommentsInFunctionsHover` which add a function's comments to their hover informations. False by default.
- New provider: [SignatureHelp](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#help-with-function-and-method-signatures).

## [1.2.0]

- New providers: [DocumentFormatting](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#format-source-code-in-an-editor) and [DocumentRangeFormatting](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#format-the-selected-lines-in-an-editor).

## [1.3.0]

- Files indexing received a big performance boost - ~2 times faster than it was before:
  - Is now performed in background, which means it is not blocking other features of the LSP.
  - Is now clustered - the number of processes depends on the number of cores on your machine.
  - Is now incremental, which means a file will be available as soon as it is indexed.

## [1.4.0]

- New provider: [Diagnostics](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#provide-diagnostics).
