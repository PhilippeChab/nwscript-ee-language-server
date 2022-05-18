# README

NWScript: EE Language Server is a Visual Studio extension LSP for the NWScript language.

While it seems to work well, even in bigger and older code bases, it is still an early project and there might be some unintended behaviours.

If you wish to have formatting on top of that, take a look at this other [extension](https://github.com/PhilippeChab/nwscript-formatter). It was written before the LSP, hence why the formatting is not included directly in it. I will migrate it to the LSP eventually if I have time.

## Dependencies

None.

## Usage

Simply open a project with nss files and the extension installed. The extension will index your files and you will be ready to go - it can currently take up to 20-30 seconds to index
big projects.

![](https://i.imgur.com/DKn8znH.png)

## Features

Enhanced syntax highlighting:

![](https://i.imgur.com/A78xmBR.png)

Completion:

![](https://i.imgur.com/Iet1Lul.gif)

Hover information:

![](https://i.imgur.com/ZARVTQs.gif)

Goto definition:

![](https://i.imgur.com/vR13onI.gif)

## Issues

Please report any issues on the github [repository](https://github.com/PhilippeChab/nwscript-ee-language-server/issues).
