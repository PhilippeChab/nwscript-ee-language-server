# NWScript EE standalone language server

The same language server used by the VS Code extension, packaged for any editor
with Language Server Protocol support. Requires Node.js 24 or newer. VS Code,
Yarn, and build tools are not needed to install a release archive.

## Install and launch

Download `nwscript-ee-language-server-VERSION.tgz` from the
[GitHub releases](https://github.com/PhilippeChab/nwscript-ee-language-server/releases)
and install it with npm:

```sh
npm install --global ./nwscript-ee-language-server-VERSION.tgz
nwscript-ee-language-server --version
nwscript-ee-language-server --stdio
```

Replace `VERSION` with the release version. Archives are npm packages; publication
to the npm registry is not required. The executable defaults to stdio when no
arguments are supplied. `--help` describes usage. npm creates the Windows command
shim automatically. Ensure npm's global executable directory is on your PATH.

Alternatively, extract the archive and launch
`node /absolute/path/to/package/bin/nwscript-ee-language-server.cjs --stdio`.
The package includes its JavaScript dependencies, indexing worker, TextMate
grammar, Oniguruma WASM, symbol definitions, and native compiler resources.
Resources resolve relative to the package, independently of the launch directory.

## Generic LSP configuration

Launch the command as a subprocess using stdin/stdout for LSP JSON-RPC framing.
Send `initialize` with `rootUri` and, if supported, `workspaceFolders`, then send
`initialized`. Use file URIs and language ID `nwscript`. Open/change/save/close
notifications drive document state; diagnostics run on open and save and use the
saved file on disk. Completion, hover, definition, symbols, and signature help do
not require a game installation. Send `shutdown`, await its response, then `exit`
to stop the server. Logs use LSP `window/logMessage`; stdout is reserved for the
protocol during server operation.

Clients supporting `workspace/configuration` should return the object below when
asked for section `nwscript-ee-lsp`. Otherwise pass it in `initializationOptions`
and send subsequent updates as `workspace/didChangeConfiguration` with
`settings: { "nwscript-ee-lsp": { ... } }`. Both a bare settings object and the
section wrapper are accepted in initialization options. Configuration responses
are complete snapshots layered over initialization options and built-in defaults;
settings omitted from a new response revert to that baseline, including custom
formatter style keys. Pushed partial updates retain unspecified settings. Null or
missing configuration responses retain current settings. Settings apply to the server process; projects requiring different
compiler or formatter settings should launch separate instances.
Unsupported configuration requests and dynamic registrations are
avoided; clients without workspace-folder support use `rootUri` (or legacy
`rootPath`). With no root provided, the launch directory is used for subprocesses.

The server uses standard LSP JSON-RPC framing, full document synchronization, and
UTF-16 positions. Hover falls back to plain text and document symbols to the flat
format unless the client advertises the richer formats. Optional configuration,
registration, and progress requests have a three-second timeout; a rejected or
unanswered request is logged and does not prevent startup. A configuration
response arriving after the timeout still applies unless a newer update has
superseded it or shutdown has begun. Compiler-setting changes after startup
revalidate open documents without requiring another save. Superseded compiler
results are discarded; disabling the compiler clears its published diagnostics,
including those on unopened includes. Shutdown cancels
pending startup requests and waits for indexing workers to terminate. Worker
cleanup also runs if the stdio connection closes without shutdown. Indexing
uses at most four workers and continues past unreadable or malformed files.

Editor-specific setup is limited to associating `.nss` files with NWScript,
launching the server, and supplying settings. Neovim below is one example, not a
runtime dependency. The server contains no Neovim-specific behavior.

```json
{
  "completion": { "addParamsToFunctions": false },
  "hovering": { "addCommentsToFunctions": false },
  "formatter": {
    "enabled": false,
    "verbose": false,
    "executable": "clang-format",
    "ignoredGlobs": [],
    "style": { "BasedOnStyle": "Google" }
  },
  "compiler": {
    "enabled": true,
    "verbose": false,
    "reportWarnings": false,
    "os": null,
    "nwnHome": "",
    "nwnInstallation": ""
  }
}
```

These are the defaults, except `formatter.style` is abbreviated: the complete
style defaults use Allman braces, tabs, four-column indentation, a 250-column
limit, and aligned comments/assignments. Style updates merge individual keys.
Ignored globs match file paths. Use absolute executable and game paths for
predictable behavior across clients. `compiler.os` can select `Linux`, `Darwin`,
or `Windows_NT`; it does not emulate another platform. The compiler executable
is bundled, while its game directories are configured using `nwnHome` and
`nwnInstallation`. Empty game paths request compiler auto-detection. Missing game
resources are reported through LSP logs. Set `compiler.enabled` to false if you
only need language features.

Formatting requires an external [clang-format](https://clang.llvm.org/docs/ClangFormat.html)
installation. Enable it and set `formatter.executable` to the executable on PATH
or its absolute path. A missing executable produces an actionable LSP log.
The native compiler supports Linux x86-64, Windows x86-64, and macOS Intel/Apple
Silicon; see [compiler requirements and licenses](https://github.com/PhilippeChab/nwscript-ee-language-server/blob/main/server/resources/compiler/README.md).
A workspace `nwscript.nss` can override bundled editor definitions. Multi-root
clients should supply workspace folders so each project selects its own file.

## Neovim 0.11 or newer

Add this to `init.lua`, adjusting the game directories:

```lua
vim.filetype.add({ extension = { nss = 'nwscript' } })
vim.lsp.config('nwscript', {
  cmd = { 'nwscript-ee-language-server', '--stdio' },
  filetypes = { 'nwscript' },
  root_markers = { 'nasher.cfg', '.git' },
  settings = {
    ['nwscript-ee-lsp'] = {
      completion = { addParamsToFunctions = false },
      hovering = { addCommentsToFunctions = true },
      compiler = {
        enabled = true,
        nwnHome = '/absolute/path/to/Neverwinter Nights/user-directory',
        nwnInstallation = '/absolute/path/to/Neverwinter Nights/installation',
      },
      formatter = { enabled = true, executable = 'clang-format' },
    },
  },
})
vim.lsp.enable('nwscript')
```

Open an `.nss` file inside your project. Use `vim.lsp.buf.hover()`,
`vim.lsp.buf.definition()`, and `vim.lsp.buf.format()` for hover, navigation, and
formatting. Completion is available through Neovim's LSP completion facilities
or your completion plugin. See the [Neovim LSP documentation](https://neovim.io/doc/user/lsp/).
Syntax highlighting is configured separately by the editor.

## Build and release

From a source checkout, install dependencies with `yarn install --frozen-lockfile`,
then run `yarn compile`, `yarn lint`, and `yarn test`. All TypeScript production,
build, and test files participate in the normal checks. The test suite builds and
installs the archive in a temporary directory and exercises it through generic
LSP messages, including capability fallbacks, startup/shutdown, failed workers,
configuration races, language features, and formatting. Tests need clang-format
on PATH (or an absolute path in `CLANG_FORMAT`); a minimal game fixture avoids
requiring an NWN installation.

`yarn package:standalone` builds only the archive; `yarn test:standalone` runs only
the packaged-server tests. Build tools live in `server/scripts/`, tests in
`server/test/`, and the CLI in `server/src/cli.ts`. The archive is created
in `dist/`. Its version comes from the root `package.json`, matching the VS Code
extension. CI tests the installed archive on the supported operating systems and
attaches it to GitHub Releases alongside the extension. The standalone package
and extension bundle the same server source.

The server is GPL-3.0-only; see [LICENSE](https://github.com/PhilippeChab/nwscript-ee-language-server/blob/main/LICENSE). Corresponding project source is
available in the matching release tag in the
[source repository](https://github.com/PhilippeChab/nwscript-ee-language-server).
Bundled dependency notices are in `third-party/`; compiler licenses and source
provenance are in `server/resources/compiler/`.
