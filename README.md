# NWScript: EE Language Server

![Build](https://github.com/PhilippeChab/nwscript-ee-language-server/actions/workflows/build.yml/badge.svg)
![Tests](https://github.com/PhilippeChab/nwscript-ee-language-server/actions/workflows/tests.yml/badge.svg)

NWScript: EE Language Server is a Visual Studio Code extension for the NWScript language.

## Features

- Enhanced syntax highlighting
- Completion
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

- Diagnostics are provided by compiling the file with the [nwnsc](https://github.com/nwneetools/nwnsc) executable.
- The compiler executable is provided for Windows, Darwin and Linux operating systems.
- Diagnostics are currently published when opening or saving a file.
- By default, the compiler will try to detect automatically your Neverwinter Nights home and installation folders if they are not specified. If it fails to do so, you can provide the paths in the extension settings like shown above - input paths are wrapped into quotes automatically.
- You can set the `verbose` setting to `true` if you wish to see detailed logs of the compilation process.
- Big files with a lot of includes can take between half a second to a second to compile on older machines - it will not affect the client performances as the processing is done on the server.

### Syntax highligthing

I personally use the [One Dark Pro](https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme) theme . See VS Code [documentation](https://code.visualstudio.com/docs/getstarted/themes) if you wish to customize the highlighting further.

## Building and running

- Install NodeJS from https://nodejs.org/en/.
- Invoke `npm install -g yarn @vscode/vsce` which will install Yarn, a dependency manager, and vsce, a VS Code packaging library.
- In the project root directory, invoke `yarn install` which will install all dependencies using Yarn.
- In the project root directory, invoke `vsce package` which will produce a .vsix file.
- To install, in VS Code on the extension pane, click on the three dots at the top right then select `Install From VSIX` and navigate to the package you just produced.

### Generating the language library definitions

Replace `/server/scripts/nwscript.nss` by its new version, `/server/scripts/base_scripts/` files by their new versions, `/server/scripts/ovr/` includes by their new versions and execute `yarn run generate-lib-defs` in the server root directory.

## Notes

The language symbols or tokens are not generated using an AST like language servers usually do. The NWScript Language Server exploits its TextMate grammar, which is derived from C's, to transform a file of code into tokens. While it works well for most cases since it is a simple scripting language built on C - even for a language like NWScript, we need to cheat and use lookahead and lookbehind strategies to ensure we are in the right context -, it will also fail for complex or uncommon code structures and styles. A TextMate grammar will never cover the most extreme cases of a language grammar. An AST represents the hierarchical structure of a file of code in a much more complete and precise way.

Implementing a language parser to build its AST is a lot of work, and none was available at the time I implemented this project. Now that NWScript compiler has been made [public](https://github.com/niv/neverwinter.nim), it would be much easier to create a utility responsible for parsing a file of code and generating its AST. Implementing this utility and refactoring the whole tokenization engine of the Language Server is, however, a non-negligible amount of work. Considering the fact that the current solution works well for common use, I do not intend to do it.

## Known issues

The nwnsc process doesn't terminate on linux. This is caused by the [compiler](https://github.com/nwneetools/nwnsc) itself, not the extension.

## Issues

Please report any issues on the github [repository](https://github.com/PhilippeChab/nwscript-ee-language-server/issues).
