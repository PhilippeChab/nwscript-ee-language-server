# Bundled NWScript standard library

The authoritative source is Beamdog's versioned [dedicated server distributions](https://nwn.beamdog.net/downloads/). The archive contains nwscript.nss in data/nwn_base.key and its referenced BIF. The installed version, archive URL, archive SHA-256, and extracted source SHA-256 are recorded in standardLibSource.json.

The initial audit against 89.8193.37-17 reproduced the existing 7,474 declarations byte for byte. The previous update, commit cf0ddd4 (PR #68), identified its source as 89.8193.37.15.

## Check for updates and update automatically

Install the repository's Node/Yarn dependencies, then run from the repository root:

```sh
yarn --cwd server update-standard-lib
```

The TypeScript updater checks Beamdog's [changelog](https://nwn.beamdog.net/docs/CHANGELOG.md) for the newest dated release using numeric version ordering, then confirms its archive exists in the official download index. If newer, it downloads the archive, verifies Beamdog's published .sha256sum, extracts nwscript.nss, and regenerates standardLibDefinitions.json. It automatically updates the version and both checksums in standardLibSource.json. No manual version or checksum editing is needed.

When already current, it still checks upstream and verifies/regenerates local definitions, reusing the extracted source if its checksum matches. Missing or altered local source is fetched again. Network, checksum, extraction, or tokenization failures stop before any repository files are changed. The script refuses to downgrade or silently accept a changed archive checksum for the same version.

Review and commit metadata and generated changes together, then run yarn compile, yarn test, and yarn build. Updates run when the maintenance command is invoked; extension startup and normal builds use committed definitions without contacting Beamdog.

## Reproduce or verify the recorded version

To reproduce the recorded version instead of checking for updates:

```sh
yarn --cwd server update-standard-lib --pinned
```

To reproduce it offline from an already downloaded archive (both archive and source checksums are still verified):

```sh
yarn --cwd server update-standard-lib --archive /absolute/path/to/recorded-release.zip
```

The extracted source is written to the ignored server/scripts/nwscript.nss. Archive entries are read in memory; server binaries are neither extracted nor executed. The updater uses TypeScript and a Node ZIP library, with no Python requirement.

`yarn --cwd server check-standard-lib` verifies the extracted source checksum and compares regenerated definitions byte for byte without writes or network access. A mismatch exits unsuccessfully. Use `yarn --cwd server generate-lib-defs --standard-only` to regenerate directly from that source.

These commands do not require the base_scripts or ovr source directories. The original generate-lib-defs command without flags still generates all three libraries and requires those separately extracted directories. Updating those other include libraries remains a separate operation.

## Workspace and custom versions

A workspace `nwscript.nss` supplies the complete standard library for completion,
hover, signature help, and Go to Definition. It replaces the bundle rather than
adding to it, so declarations absent from an older/custom API are not suggested.
No `#include "nwscript"` is needed; an explicit include does not duplicate the API.
Ordinary local and included declarations keep their existing precedence.

Selection is scoped to the workspace folder containing the requesting script
(the most specific folder in a nested workspace). The exact filename is matched
case-insensitively. A root-level file wins; otherwise the shallowest file wins,
with lexical relative path order breaking ties. Nested workspace folders are
excluded from their parent's candidates. Files outside all workspace folders use
the bundle. Additional `nwscript.nss` copies do not override the selected file.

Definitions are cached and retokenized when source content changes. Editor
features see unsaved changes to an open selected file. The VS Code file watcher
refreshes selection on file creation, external modification, deletion, or rename;
workspace folder changes also refresh selection. Closing the file discards its
unsaved snapshot and reloads the saved source. A new file must exist on disk to
be discovered. Removing it selects the next candidate or restores the bundle.

If reading or tokenizing fails, or no declarations can be parsed, the server logs
the problem to the language server output and retains the last usable definitions
for that file. Without a usable snapshot it falls back to the bundle. This uses
the existing TextMate tokenizer, not a semantic validator: a successful parse does
not guarantee a valid or complete game API. Imported declarations in a custom
`nwscript.nss` are not expanded; keep the engine declarations in that file.

Compiler diagnostics select the same workspace file but compile its **saved disk
contents**, as they do other scripts. Save edits before expecting compiler
results to match them. Saving or externally changing the specification also
refreshes diagnostics for open scripts. A malformed saved specification can therefore produce
compiler errors while editor help retains its last usable snapshot. With no
workspace specification, diagnostics use the configured game installation's
resources, while editor help uses the bundled version. Compiler installation/home
settings do not select editor definitions.

An arbitrary configured source path and runtime downloads are not implemented.
