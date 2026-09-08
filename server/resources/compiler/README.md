# Bundled native compiler

Diagnostics use `nwn_script_comp` from [neverwinter.nim 2.3.1](https://github.com/niv/neverwinter.nim/releases/tag/2.3.1), source revision `369fdc4186f19d3668f05b44f9b98d32ea5233c4`.

- Linux x86-64: `nwn_script_comp` from `neverwinter-x86_64-linux-gnu.zip`.
- Windows x86-64: `nwn_script_comp.exe` and the accompanying 64-bit runtime DLLs/certificate bundle from `neverwinter-x86_64-windows.zip`.
- macOS Intel and Apple Silicon: a universal executable produced by `.github/workflows/compiler-macos.yml`. The upstream Intel archive omits `nwn_script_comp`, so the workflow builds the pinned source with Nim 2.2.10 and combines it with the compiler in upstream's `neverwinter-aarch64-macos.zip` using `lipo`.

The compiler remains a subprocess. `-s` prevents writing build artifacts and `--no-require-entry-point` enables syntax and semantic validation of standalone includes.

The native compiler core is licensed under GPL-3.0; its license is included in `GPL-3.0.txt`. Source and component licensing information are available in the pinned upstream revision. Keep this provenance and the license alongside redistributed executables.
