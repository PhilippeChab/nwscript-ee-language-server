# NWScript: EE Language Server

![Build](https://github.com/PhilippeChab/nwscript-ee-language-server/actions/workflows/build.yml/badge.svg)
![Tests](https://github.com/PhilippeChab/nwscript-ee-language-server/actions/workflows/tests.yml/badge.svg)

NWScript: EE Language Server provides language features for NWScript through a Visual Studio Code extension or an installable standalone LSP server.

## Features

- Enhanced syntax highlighting
- Completion
- Auto-import
- Hover information
- Goto definition
- Formatting
- Range formatting
- Signature help
- Diagnostics
- Document Symbols

## Dependencies

### Formatting

[clang-format](https://clang.llvm.org/docs/ClangFormat.html).

### Diagnostics

Neverwinter Nights home and installation folders.

## Usage

Simply open a project with nss files and the extension installed.

### Other editors

Install the standalone archive from GitHub Releases with npm and launch `nwscript-ee-language-server --stdio`. See the [standalone installation and configuration guide](server/README.md) for Neovim and generic LSP clients.

### Formatting

```
{
  "editor.formatOnSave": true,
  "files.associations": {
    "*.nss": "nwscript"
  },
  "[nwscript]": {
    "editor.defaultFormatter": "PhilippeChab.nwscript-ee-language-server"
  },
  "nwscript-ee-lsp.formatter": {
    "enabled": true,
    "executable": "clang-format",
    "ignoredGlobs": ["/folder/to/ignore/*.nss", "file/to/ignore/filename.nss"],
    "style": {
      "BasedOnStyle": "Google",
      "AlignTrailingComments": true,
      "AlignConsecutiveAssignments": true,
      "ColumnLimit": 250,
      "BreakBeforeBraces": "Allman",
      "AlignEscapedNewlinesLeft": true,
      "AlwaysBreakBeforeMultilineStrings": true,
      "MaxEmptyLinesToKeep": 1,
      "TabWidth": 4,
      "IndentWidth": 4,
      "UseTab": "Always"
    }
  }
}
```

Notes:

- The executable setting must either bet set to your path executable's identifier, or its absolute path.
- The style object must respect clang-format [rules](https://clang.llvm.org/docs/ClangFormatStyleOptions.html).

### Diagnostics

```
{
  "nwscript-ee-lsp.compiler": {
    "enabled": true,
    "verbose": false,
    "nwnHome": "C:\\Users\\YOUR_USERNAME\\Documents\\Neverwinter Nights",
    "nwnInstallation": "D:\\Program Files (x86)\\Steam\\steamapps\\common\\Neverwinter Nights"
  }
}
```

Notes:

- Diagnostics are provided by compiling the file with the [nwn_script_comp](https://github.com/niv/neverwinter.nim/blob/master/nwn_script_comp.nim) compiled executable.
- The compiler executable is provided for Windows, Darwin and Linux operating systems.
- Diagnostics are currently published when opening or saving a file.
- Standalone include files are checked for syntax and semantic errors without requiring `main` or `StartingConditional`. Diagnostics run in dry-run mode and do not write `.ncs` or `.ndb` files.
- The bundled compiler reports the first error per compilation; reporting multiple errors within one file is a separate upstream enhancement.
- By default, the compiler will try to detect automatically your Neverwinter Nights home and installation folders if they are not specified. If it fails to do so, you can provide the paths in the extension settings like shown above - paths are passed directly to the compiler, including paths containing spaces.
- You can set the `verbose` setting to `true` if you wish to see detailed logs of the compilation process.

### Syntax highligthing

I personally use the [One Dark Pro](https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme) theme . See VS Code [documentation](https://code.visualstudio.com/docs/getstarted/themes) if you wish to customize the highlighting further.

## Building and running

- Install Node.js 24 (the version in `.nvmrc`). With nvm, run `nvm install` and `nvm use` in the project root.
- Invoke `npm install -g yarn@1.22.22 @vscode/vsce` to install Yarn Classic and the VS Code packaging tool.
- In the project root directory, invoke `yarn install --frozen-lockfile`. The postinstall script also installs the client and server dependencies using their committed lockfiles.
- Install `clang-format` and make it available on PATH (or set `CLANG_FORMAT` to its absolute path) for the packaged-server integration tests.
- Run `yarn compile`, `yarn lint`, `yarn test`, and `yarn build` to type-check, test, and bundle the extension. CI uses the same Node and Yarn versions.
- In the project root directory, invoke `vsce package` which will produce a .vsix file.
- To install, in VS Code on the extension pane, click on the three dots at the top right then select `Install From VSIX` and navigate to the package you just produced.

### Generating the language library definitions

Check for the latest Beamdog release and automatically update the bundled standard library:

```sh
yarn --cwd server update-standard-lib
```

The TypeScript updater discovers the latest release, verifies its archive, regenerates definitions, and records the new version and checksums. Use `--pinned` to reproduce the recorded version, or `check-standard-lib` to verify local definitions without network access. See [standard library update instructions](server/resources/STANDARD_LIBRARY.md) for details and offline use.

To regenerate the bundled include indexes from the recorded game archive, run `yarn --cwd server generate-lib-defs --archive /absolute/path/to/recorded-release.zip`. Add `--check` to verify them without writing.

A workspace `nwscript.nss` replaces the bundled standard library for completion, hover, signature help, and Go to Definition without needing an `#include`. Compiler diagnostics use the same selected file from disk. Each workspace folder selects its own file: a root-level file wins, then the shallowest subdirectory, then lexical path order. Selection matches the exact filename, case-insensitively.

Unsaved edits update editor definitions. External changes, creation, deletion, and workspace folder changes are picked up automatically. If a file becomes unreadable or cannot be parsed, the server logs the problem and retains its last usable definitions; if none exist, it uses the bundle. Removing the file restores bundled definitions (or selects the next workspace candidate). Closing a file discards unsaved definitions and reloads disk contents. See [standard library behavior](server/resources/STANDARD_LIBRARY.md#workspace-and-custom-versions) for details.

## Notes

This draft branch replaces TextMate-based server parsing with a Tree-sitter syntax tree. The existing providers consume its declaration index and scope/context queries; VS Code still uses TextMate for syntax highlighting. Compiler diagnostics continue to use the bundled NWScript compiler.

See the [replacement PoC](server/poc/tree-sitter/README.md) for the code reduction, test results, reproduction commands, and remaining recovery and language-conformance limitations. This is an experimental branch, not a released parser migration.

## Issues

Please report any issues on the github [repository](https://github.com/PhilippeChab/nwscript-ee-language-server/issues).

## License

Copyright (c) 2022-2026 Philippe Chabot and contributors.

The language server is licensed under the [GNU General Public License, version 3 only](LICENSE) (`GPL-3.0-only`). Distributed modified versions must comply with its corresponding-source and licensing requirements.

Third-party dependencies, bundled tools, and game-derived assets retain their respective licensing terms; the project's GPL license does not relicense them. See the [bundled compiler documentation](server/resources/compiler/README.md) for its license and source provenance.
