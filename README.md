# README

NWScript: EE Language Server is a Visual Studio Code extension LSP for the NWScript language.

While it seems to work well, even in bigger and older code bases, it is still an early project and there might be some unintended behaviours.

## Dependencies

### Formatting

[clang-format](https://clang.llvm.org/docs/ClangFormat.html).

## Usage

Simply open a project with nss files and the extension installed. The extension will index your files and you will be ready to go - it can currently take up to 10-15 seconds to index big projects.

![](https://i.imgur.com/DKn8znH.png)

Notes:

- The files are indexed in background processes, which means it will not block other features of the LSP like formatting, and a file's local definitions generated on the fly will be available.
- The files are indexed incrementally, which means a file's global definitions become available as soon as it has been indexed.

### Formatting

```
{
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

- The executable setting must either bet set to you path executable's identifer, or its absolute path.
- The style object must respect clang-format [rules](https://clang.llvm.org/docs/ClangFormatStyleOptions.html).

## Features

Enhanced syntax highlighting:

![](https://i.imgur.com/A78xmBR.png)

Completion:

![](https://i.imgur.com/Iet1Lul.gif)

Hover information:

![](https://i.imgur.com/ZARVTQs.gif)

Goto definition:

![](https://i.imgur.com/vR13onI.gif)

Also:

- Formatting
- Range formatting
- Signature help

## Issues

Please report any issues on the github [repository](https://github.com/PhilippeChab/nwscript-ee-language-server/issues).

## Building and running

- Install NodeJS from https://nodejs.org/en/
- Invoke `npm install -g yarn vsce` which will install Yarn, a dependency manager, and vsce, a VS Code packaging library
- In the project root directory, invoke `yarn install` which will install all dependencies using Yarn
- Optional: If you want to regenerate data from nwscript.nss, place it in `servers/resources/nwscript.nss` then invoke `npm install -g ts-node` and afterwards, from the project root directory, `ts-node server/scripts/GenerateLibDefinitions.ts`.
- In the project root directory, invoke `vsce package` which will produce a .vsix file
- To install, in VS Code on the extension pane, click on the three dots at the top right then select Install From VSIX and navigate to the package you just produced.
