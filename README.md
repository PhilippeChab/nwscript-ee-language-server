# README

NWScript: EE Language Server is a Visual Studio Code extension LSP for the NWScript language.

While it seems to work well, even in bigger and older code bases, it is still an early project and there might be some unintended behaviours.

## Dependencies

### Formatting

[clang-format](https://clang.llvm.org/docs/ClangFormat.html).

## Usage

Simply open a project with nss files and the extension installed. The extension will index your files and you will be ready to go - it can currently take up to 20-30 seconds to index big projects.

![](https://i.imgur.com/DKn8znH.png)

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
