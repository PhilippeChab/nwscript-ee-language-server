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

Neverwinter Nights home and installation folders.

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
- You can set the `verbose` setting to `true` if you wish to see detailed logs of the compilation process.

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

## Issues

Please report any issues on the github [repository](https://github.com/PhilippeChab/nwscript-ee-language-server/issues).

## License

Copyright (c) 2022-2026 Philippe Chabot and contributors.

The language server is licensed under the [GNU General Public License, version 3 only](LICENSE) (`GPL-3.0-only`). Distributed modified versions must comply with its corresponding-source and licensing requirements.

Third-party dependencies, bundled tools, and game-derived assets retain their respective licensing terms; the project's GPL license does not relicense them. See the [bundled compiler documentation](server/resources/compiler/README.md) for its license and source provenance.
