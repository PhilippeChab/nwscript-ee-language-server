# README

NWScript: EE Language Server is a Visual Studio Code extension LSP for the NWScript language.

While it seems to work well, even in bigger and older code bases, it is still an early project and there might be some unintended behaviours.

## Dependencies

### Formatting

[clang-format](https://clang.llvm.org/docs/ClangFormat.html).

### Diagnostics

Neverwinter Nights home and installation folders.

## Usage

Simply open a project with nss files and the extension installed. The extension will index your files and you will be ready to go - it can currently take up to 10-15 seconds to index big projects.

![](https://i.imgur.com/DKn8znH.png)

Notes:

- The files are indexed in background processes, which means it will not block other features of the LSP like formatting, and a file's local definitions generated on the fly will be available.
- The files are indexed incrementally, which means a file's global definitions become available as soon as it has been indexed.

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

- The executable setting must either bet set to you path executable's identifier, or its absolute path.
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
- In order to compile a file's includes, the compiler needs to know their directories. Files that had been requested a diagnostic while the project is being indexed are queued and processed once the indexing is done.
- You can set the `verbose` setting to `true` if you wish to see detailed logs of the compilation process.
- Big files with a lot of includes can take between half a second to a second to compile on older machines - it will not affect the client performances as the processing is done on the server.

## Features

Enhanced syntax highlighting - the following example is with the [One Dark Pro](https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme) theme:

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
- Diagnostics

## Building and running

- Install NodeJS from https://nodejs.org/en/.
- Invoke `npm install -g yarn vsce` which will install Yarn, a dependency manager, and vsce, a VS Code packaging library.
- In the project root directory, invoke `yarn install` which will install all dependencies using Yarn.
- In the project root directory, invoke `vsce package` which will produce a .vsix file.
- To install, in VS Code on the extension pane, click on the three dots at the top right then select `Install From VSIX` and navigate to the package you just produced.

### Generating the language library definitions

Replace `server/resources/nwscript.nss` by its new version and execute `yarn run generate-lib-defs` in the server root directory.

## Modifying themes

vsCode's themes generally work very well.  However, because tokens are returned via scope and not semantically analyzed, the tokens may not always be highlighted with the colors that make sense to the user.  One example of this is in vsCode's Dark+ theme where a functions arguments/parameters is colored differently than the same token used within the function body.  To modify portions of a theme to better suit user preferences, add the `editor.tokenColorCustomizations` block to the local `settings.json` file.  Within this section, the user can select universal or theme-based modification to token colors.  Here's an example of a modification for the Dark+ theme that does the following:

1) Highlights variables within the function the same color as function arguments/parameters
2) Highlights constants (all caps) in a color different than variables
3) Highlights the hexadecimal prefix (`0x`) in the same color as all other numbers and makes it bold/underline
4) Highlights variables modifiers (such as `const`) in bold/italics

```
"editor.tokenColorCustomizations": {
    "[Default Dark+]": {
        "textMateRules": [
            {
                "scope": "variable.language, variable.parameter",
                "settings": {
                    "foreground": "#9cdcfe"
                }
            },
            {
                "scope": "constant.language",
                "settings": {
                    "foreground": "#d19a66"
                }
            },
            {
                "scope": "keyword.other.unit.hexadecimal",
                "settings": {
                    "foreground": "#b5cea8",
                    "fontStyle": "bold underline"
                }
            },
            {
                "scope": "storage.modifier",
                "settings": {
                    "fontStyle": "bold italic"
                }
            }
        ]
    }
  }
}
```

Here's an example of a simple function highlighted using vsCode's Dark+ theme, both before and after the modification made above:

![](https://i.imgur.com/K918zP0.jpg)

![](https://i.imgur.com/pz57iA1.jpg)

Modifying thematic highlighting requires knowledge of the token's scope.  To determine a token's scope, use vsCode's `Inspect Editor Tokens and Scopes` function, which can be found using the `F1` searchbox.  Once this function is selected, hover over any token and the inspector will display the token's scope and highlight color.

For the purposes of `scope` in the `settings.json` file, use the scope listed at the top of the `textmate scopes` inspection block, but do not include the `.nss` suffix.  Here is an example of the information the inspector provides:

![](https://i.imgur.com/Q4Y1UNK.jpg)

## Issues

Please report any issues on the github [repository](https://github.com/PhilippeChab/nwscript-ee-language-server/issues).
