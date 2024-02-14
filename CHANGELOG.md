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

## [1.4.1]

- Fixed compiler `-i` parameter for Darwin and Linux operating systems.
- The tokenization process now supports function definitions spread over multiple lines.

## [1.4.2]

- Fixed a few issues with the tokenizer

## [1.5.0]

- The extension size has been lowered from 14.7 to 4.8 MB.

## [1.5.1]

- Eslint has been configured along with prettier and the project will be linted from now on.
- File handling is now done with their uri instead of their path.

## [1.5.2]

- `const` expressions resolution has been enhanced.

## [1.5.3]

- Goto will now work for functions and constants from `nwscript.nss` if the file is in your project.
- Fixed a few issues with the tokenizer.
- Fixed a small issue with `const` expressions resolution.
- Fixed the compilation provider not reporting warnings.
- New compiler setting `reportWarnings`. True by default.
- New formatter setting `verbose`. False by default.

## [1.5.4]

- Fixed security issues.
- The project is now bundled with esbuild instead of webpack.

## [1.5.5]

- Build the indexer again... yikes.

## [2.0.0]

- `GenerateLibDefinitions.ts` now also generates definitions for files in `/data/base_scripts.bif` and files in the `/ovr` folder. See the [README.md](./README.md#generating-the-language-library-definitions) for more details.
- Static scripts definitions are now provided as fallback if they don't exist in the project directory. This includes files in `/data/base_scripts.bif` and files in the `/ovr` folder.
- New setting `os` for diagnostics that forces the extension to use the executable of a specific os. Can be useful for wsl, for example. `null` by default.
- The extension no longer indexes the project files in background at project startup. Instead, it will index a file and its children when it is opened.
- The compilers have been updated to their latest versions.
- `nwscript.nss` definitions have been updated.
- The setting `autoCompleteFunctionsWithParams` is now `completion.addParamsToFunctions`.
- The setting `includeCommentsInFunctionsHover` is now `hovering.addCommentsToFunctions`.

## [2.0.1]

I think we can consider the extension stable and out of beta. A big thank you to everyone who has been implied in a way or another in its development! :)

## [2.0.2]

- Indexing added back. Its removal caused performances issues.

## [2.1.0]

- New provider: [Document Symbols](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#show-all-symbol-definitions-within-a-document).
- Fixed a small issue with the `CompletionItemsProvider`.
- Goto will now _really_ work with definitions from `nwscript.nss` if the file is in your project.

## [2.1.1]

- Fixed some dependabot issues.
- Refactored some internals, might have introduce regressions.
- Fixed vscode 1.86 update making vscode-textmate 7 failing to parse plist files.
