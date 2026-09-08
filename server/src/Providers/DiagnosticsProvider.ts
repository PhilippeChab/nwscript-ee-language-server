import { spawn } from "child_process";
import { type } from "os";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";

import Provider from "./Provider";

const compilerDiagnostic = /(?:^|:\s)([^:\r\n]+?\.nss)(?:\((\d+)\))?:\s*(ERROR|WARNING):\s*(.*)/;

enum OS {
  linux = "Linux",
  mac = "Darwin",
  windows = "Windows_NT",
}

type FilesDiagnostics = { [uri: string]: Diagnostic[] };
export default class DiagnoticsProvider extends Provider {
  private generateDiagnostics(uris: string[], files: FilesDiagnostics, severity: DiagnosticSeverity) {
    return (line: string) => {
      const match = compilerDiagnostic.exec(line);
      if (!match) return;

      const matchingUri = uris.find((uri) => basename(fileURLToPath(uri)).toLowerCase() === match[1].trim().toLowerCase());
      const uri = matchingUri || uris[0];

      if (uri) {
        const linePosition = matchingUri ? Math.max(0, Number(match[2] || 1) - 1) : 0;
        const diagnostic = {
          severity,
          range: {
            start: { line: linePosition, character: 0 },
            end: { line: linePosition, character: Number.MAX_VALUE },
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

  private getExecutablePath(os: OS | null) {
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

  public async publish(uri: string) {
    return await new Promise<boolean>((resolve) => {
      const { enabled, nwnHome, reportWarnings, nwnInstallation, verbose, os } = this.server.config.compiler;
      if (!enabled || uri.includes("nwscript.nss")) {
        return resolve(true);
      }

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

      if (verbose) {
        this.server.logger.info(`Compiling ${document.uri}:`);
      }
      // The compiler command:
      //  - y; continue on error
      //  - s; dry run
      // Validate include-only files, including semantic errors in their functions.
      // Each publish checks one root, so avoid starting a pool for every CPU.
      const args = ["-y", "-s", "-j", "1", "--no-require-entry-point"];
      if (Boolean(nwnHome)) {
        args.push("--userdirectory");
        args.push(nwnHome);
      } else if (verbose) {
        this.server.logger.info("Trying to resolve Neverwinter Nights home directory automatically.");
      }
      if (Boolean(nwnInstallation)) {
        args.push("--root");
        args.push(nwnInstallation);
      } else if (verbose) {
        this.server.logger.info("Trying to resolve Neverwinter Nights installation directory automatically.");
      }
      const includeDirectories = new Set(uris.map((uri) => dirname(fileURLToPath(uri))));
      includeDirectories.add(this.server.workspaceFilesSystem.getWorkspaceRootPath());
      const languageSpec = this.server.workspaceFilesSystem.getFilePath("nwscript");
      if (languageSpec) includeDirectories.add(dirname(languageSpec));
      args.push("--dirs", [...includeDirectories].join(","));
      args.push("-c", fileURLToPath(uri));

      let stderr = "";

      if (verbose) {
        this.server.logger.info(this.getExecutablePath(os));
        this.server.logger.info(JSON.stringify(args, null, 4));
      }

      const child = spawn(join(__dirname, this.getExecutablePath(os)), args, { stdio: ["ignore", "ignore", "pipe"] });

      child.stderr.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (e: any) => {
        this.server.logger.error(e.message);
        resolve(false);
      });

      child.on("close", (code, signal) => {
        if (signal) {
          const error = new Error(`Compiler terminated by ${signal}`);
          this.server.logger.error(error.message);
          resolve(false);
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
            this.server.logger.info(line);
          }

          // Diagnostics
          if (line.includes("ERROR:")) {
            errors.push(line);
          }

          if (reportWarnings && line.includes("WARNING:")) {
            warnings.push(line);
          }

          // Actual errors
          if (line.includes("unhandled exception")) {
            this.server.logger.error(line);
          }

          if (line.includes("Could not locate")) {
            if (Boolean(nwnHome) || Boolean(nwnInstallation)) {
              return this.server.logger.error("Unable to resolve provided Neverwinter Nights home and/or installation directories. Ensure the paths are valid in the extension settings.");
            } else {
              return this.server.logger.error("Unable to automatically resolve Neverwinter Nights home and/or installation directories.");
            }
          }
        });

        if (verbose) {
          this.server.logger.info("Done.\n");
        }

        if (code !== 0 && !errors.some((line) => compilerDiagnostic.test(line))) {
          const error = new Error(stderr.trim() || `Compiler exited with code ${String(code)}`);
          this.server.logger.error(error.message);
          resolve(false);
          return;
        }

        errors.forEach(this.generateDiagnostics(uris, files, DiagnosticSeverity.Error));
        if (reportWarnings) warnings.forEach(this.generateDiagnostics(uris, files, DiagnosticSeverity.Warning));

        for (const [uri, diagnostics] of Object.entries(files)) {
          this.server.connection.sendDiagnostics({ uri, diagnostics });
        }
        resolve(true);
      });
    });
  }

  public async processDocumentsWaitingForPublish() {
    return await Promise.all(this.server.documentsWaitingForPublish.map(async (uri) => await this.publish(uri)));
  }
}
