import { spawn } from "child_process";
import { type, tmpdir } from "os";
import { copyFileSync, mkdtempSync, rmSync, statSync, readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";

import Provider from "./Provider";
import type { ServerConfiguration } from "../ServerManager/Config";
import { isStandardLibrary } from "../Documents/StandardLibrary";

const compilerDiagnostic = /(?:^|:\s)([^:\r\n]+?\.nss)(?:\((\d+)\))?:\s*(ERROR|WARNING):\s*(.*)/;

enum OS {
  linux = "Linux",
  mac = "Darwin",
  windows = "Windows_NT",
}

type FilesDiagnostics = { [uri: string]: Diagnostic[] };
export default class DiagnoticsProvider extends Provider {
  private nextValidation = 0;
  private readonly latestValidation = new Map<string, number>();
  private readonly publishedUris = new Set<string>();

  public configurationChanged() {
    // Results from any previous configuration are no longer authoritative.
    this.latestValidation.clear();
    if (!this.server.config.compiler.enabled) {
      for (const uri of this.publishedUris) this.sendDiagnostics(uri, []);
    }
  }

  public async publish(uri: string) {
    return await new Promise<boolean>((resolve) => {
      const compilerSettings = JSON.stringify(this.server.config.compiler);
      const { enabled, nwnHome, reportWarnings, nwnInstallation, verbose, os } = this.server.config.compiler;
      if (!enabled) {
        this.configurationChanged();
        return resolve(true);
      }
      if (isStandardLibrary(uri)) return resolve(true);
      const validation = ++this.nextValidation;
      this.latestValidation.set(uri, validation);
      const isCurrent = (target: string) => this.latestValidation.get(target) === validation && compilerSettings === JSON.stringify(this.server.config.compiler);

      if (!this.hasSupportedOS()) {
        const errorMessage = "Unsupported OS. Cannot provide diagnostics.";
        this.server.logger.error(errorMessage);
        return resolve(false);
      }

      const document = this.server.documentsCollection.getFromUri(uri);

      if (!this.server.configLoaded || !document) {
        if (!this.server.documentsWaitingForPublish.includes(uri)) {
          this.server.documentsWaitingForPublish.push(uri);
        }
        return resolve(true);
      }

      const fail = (reason: string) => {
        if (isCurrent(uri)) this.server.logger.error(`Unable to validate ${uri}: ${reason}. Previous diagnostics have been retained.`);
        resolve(false);
      };
      try {
        // The upstream resource resolver treats zero-byte files as missing.
        if (statSync(fileURLToPath(uri)).size === 0) {
          this.sendDiagnostics(uri, []);
          resolve(true);
          return;
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return;
      }

      const children = document.getChildren();
      const files: FilesDiagnostics = { [document.uri]: [] };
      const uris: string[] = [document.uri];
      children.forEach((child) => {
        const fileUri = this.server.documentsCollection.get(child)?.uri;
        if (fileUri) {
          files[fileUri] = [];
          uris.push(fileUri);
        }
      });

      for (const target of uris) this.latestValidation.set(target, validation);

      if (verbose) {
        this.server.logger.debug(`Compiling ${document.uri}:`);
      }
      // The compiler command:
      //  - y; continue on error
      //  - s; dry run
      // Validate include-only files, including semantic errors in their functions.
      // Each publish checks one root, so avoid starting a pool for every CPU.
      const args = ["-y", "-s", "-j", "1", "--no-require-entry-point", `--max-include-depth=${Math.max(64, uris.length + 1)}`];
      if (Boolean(nwnHome)) {
        args.push("--userdirectory");
        args.push(nwnHome);
      } else if (verbose) {
        this.server.logger.debug("Trying to resolve Neverwinter Nights home directory automatically.");
      }
      if (Boolean(nwnInstallation)) {
        args.push("--root");
        args.push(nwnInstallation);
      } else if (verbose) {
        this.server.logger.debug("Trying to resolve Neverwinter Nights installation directory automatically.");
      }
      const includeDirectories = new Set(uris.map((uri) => dirname(fileURLToPath(uri))));
      includeDirectories.add(this.server.workspaceFilesSystem.getWorkspaceRootPath());
      const languageSpec = this.server.standardLibrary.getPath(uri);
      if (languageSpec) includeDirectories.add(dirname(languageSpec));
      args.push("--dirs", [...includeDirectories].join(","));
      // Directory ordering cannot express arbitrary per-file selections, and the
      // compiler always gives its input directory priority. Stage the indexed
      // documents together so compilation uses the same includes as navigation.
      // Copies also isolate the compiler's automatic deletion of adjacent NDBs.
      let stagingDirectory: string | undefined;
      const sources = new Map<string, string[]>();
      try {
        stagingDirectory = mkdtempSync(join(tmpdir(), "nwscript-compile-"));
        const selected = new Map<string, string>();
        for (const selectedUri of uris) {
          const path = fileURLToPath(selectedUri);
          const name = basename(path).toLowerCase();
          if (!selected.has(name)) selected.set(name, path);
        }
        if (languageSpec) selected.set("nwscript.nss", languageSpec);
        for (const [name, path] of selected) copyFileSync(path, join(stagingDirectory, name));
        // Match diagnostic ranges to the exact saved text sent to the compiler.
        // JavaScript string lengths are UTF-16 offsets, as required by LSP.
        for (const selectedUri of uris) {
          sources.set(selectedUri, readFileSync(join(stagingDirectory, basename(fileURLToPath(selectedUri)).toLowerCase()), "utf8").split(/\r\n|\r|\n/));
        }
        args.push("-c", join(stagingDirectory, basename(fileURLToPath(uri)).toLowerCase()));
      } catch (error) {
        if (stagingDirectory) rmSync(stagingDirectory, { recursive: true, force: true });
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      const cleanup = () => {
        if (stagingDirectory) rmSync(stagingDirectory, { recursive: true, force: true });
      };

      let stderr = "";

      if (verbose) {
        this.server.logger.debug(this.getExecutablePath(os));
        this.server.logger.debug(JSON.stringify(args, null, 4));
      }

      const child = spawn(join(__dirname, this.getExecutablePath(os)), args, { stdio: ["ignore", "ignore", "pipe"] });

      child.stderr.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (e: any) => {
        cleanup();
        fail(e.message);
      });

      child.on("close", (code, signal) => {
        cleanup();
        // A failed spawn also emits close after its error event.
        if (child.pid === undefined) return;
        if (!uris.some(isCurrent)) {
          resolve(true);
          return;
        }
        if (signal) {
          const error = new Error(`Compiler terminated by ${signal}`);
          fail(error.message);
          return;
        }
        const lines = stderr
          .toString()
          .split("\n")
          .filter((line) => line !== "\r" && line !== "\n" && Boolean(line));
        const errors: string[] = [];
        const warnings: string[] = [];

        lines.forEach((line) => {
          if (verbose) {
            this.server.logger.debug(line);
          }

          // Diagnostics
          if (line.includes("ERROR:")) {
            errors.push(line);
          }

          if (reportWarnings && line.includes("WARNING:")) {
            warnings.push(line);
          }
        });

        if (verbose) {
          this.server.logger.debug("Done.\n");
        }

        if (code !== 0 && !errors.some((line) => compilerDiagnostic.test(line))) {
          const reason = stderr.includes("Could not locate")
            ? "Cannot locate the Neverwinter Nights installation or user directory. Check the compiler nwnInstallation and nwnHome settings"
            : stderr.trim() || `Compiler exited with code ${String(code)}`;
          fail(reason);
          return;
        }

        errors.forEach(this.generateDiagnostics(uris, files, sources, DiagnosticSeverity.Error));
        if (reportWarnings) warnings.forEach(this.generateDiagnostics(uris, files, sources, DiagnosticSeverity.Warning));

        for (const [uri, diagnostics] of Object.entries(files)) {
          if (isCurrent(uri)) this.sendDiagnostics(uri, diagnostics);
        }
        resolve(true);
      });
    });
  }

  public async processDocumentsWaitingForPublish() {
    return await Promise.all(this.server.documentsWaitingForPublish.map(async (uri) => await this.publish(uri)));
  }

  private sendDiagnostics(uri: string, diagnostics: Diagnostic[]) {
    if (diagnostics.length) this.publishedUris.add(uri);
    else this.publishedUris.delete(uri);
    void this.server.connection.sendDiagnostics({ uri, diagnostics });
  }

  private generateDiagnostics(uris: string[], files: FilesDiagnostics, sources: Map<string, string[]>, severity: DiagnosticSeverity) {
    return (line: string) => {
      const match = compilerDiagnostic.exec(line);
      if (!match) return;

      const matchingUri = uris.find((uri) => basename(fileURLToPath(uri)).toLowerCase() === match[1].trim().toLowerCase());
      const uri = matchingUri || uris[0];

      if (uri) {
        const sourceLines = sources.get(uri) || [""];
        const linePosition = matchingUri ? Math.min(sourceLines.length - 1, Math.max(0, Number(match[2] || 1) - 1)) : 0;
        const diagnostic = {
          severity,
          range: {
            start: { line: linePosition, character: 0 },
            end: { line: linePosition, character: sourceLines[linePosition].length },
          },
          message: `${matchingUri ? "" : `${match[1].trim()}(${match[2] || 1}): `}${match[4].replace(/\s+\[<?[\d.]+ms\]$/, "").trim()}`,
        };

        files[uri].push(diagnostic);
      }
    };
  }

  private hasSupportedOS() {
    return ([...Object.values(OS).filter((item) => isNaN(Number(item)))] as string[]).includes(type());
  }

  private getExecutablePath(os: ServerConfiguration["compiler"]["os"]) {
    const specifiedOs = os || type();

    switch (specifiedOs) {
      case OS.linux:
        return "../resources/compiler/linux/nwn_script_comp";
      case OS.mac:
        return "../resources/compiler/mac/nwn_script_comp";
      case OS.windows:
        return "../resources/compiler/windows/nwn_script_comp.exe";
      default:
        return "";
    }
  }
}
