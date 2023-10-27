import { spawn } from "child_process";
import { type } from "os";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";

import { ServerManager } from "../ServerManager";
import Provider from "./Provider";

const lineNumber = /\(([^)]+)\)/;
const lineMessage = /(ERROR|WARNING):(.*)/;
const lineFilename = /(:\s)([^(]+)/;

enum OS {
  linux = "Linux",
  mac = "Darwin",
  windows = "Windows_NT",
}

type FilesDiagnostics = { [uri: string]: Diagnostic[] };
export default class DiagnoticsProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);
  }

  private generateDiagnostics(uris: string[], files: FilesDiagnostics, severity: DiagnosticSeverity) {
    return (line: string) => {
      const uri = uris.find((uri) => basename(fileURLToPath(uri)) === lineFilename.exec(line)![2]);

      if (uri) {
        const linePosition = Number(lineNumber.exec(line)![1]) - 1;
        const diagnostic = {
          severity,
          range: {
            start: { line: linePosition, character: 0 },
            end: { line: linePosition, character: Number.MAX_VALUE },
          },
          message: lineMessage.exec(line)![2].trim(),
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

  public publish(uri: string) {
    return new Promise<boolean>((resolve, reject) => {
      const { enabled, nwnHome, reportWarnings, nwnInstallation, verbose, os } = this.server.config.compiler;
      if (!enabled || uri.includes("nwscript.nss")) {
        return resolve(true);
      }

      if (!this.hasSupportedOS()) {
        const errorMessage = "Unsupported OS. Cannot provide diagnostics.";
        this.server.logger.error(errorMessage);
        return reject(new Error(errorMessage));
      }

      const document = this.server.documentsCollection.getFromUri(uri);

      if (!this.server.configLoaded || !document) {
        if (!this.server.documentsWaitingForPublish.includes(uri)) {
          this.server.documentsWaitingForPublish?.push(uri);
        }
        return resolve(true);
      }

      const children = document.getChildren();
      const files: FilesDiagnostics = { [document.uri]: [] };
      const uris: string[] = [];
      children.forEach((child) => {
        const fileUri = this.server.documentsCollection?.get(child)?.uri;
        if (fileUri) {
          files[fileUri] = [];
          uris.push(fileUri);
        }
      });

      if (verbose) {
        this.server.logger.info(`Compiling ${document.uri}:`);
      }
      // The compiler commands:
      //  - y; continue on error
      //  - s; dry run
      const args = ["-y", "-s"];
      if (Boolean(nwnHome)) {
        args.push("--userdirectory");
        args.push(`"${nwnHome}"`);
      } else if (verbose) {
        this.server.logger.info("Trying to resolve Neverwinter Nights home directory automatically.");
      }
      if (Boolean(nwnInstallation)) {
        args.push("--root");
        args.push(`"${nwnInstallation}"`);
      } else if (verbose) {
        this.server.logger.info("Trying to resolve Neverwinter Nights installation directory automatically.");
      }
      if (children.length > 0) {
        args.push("--dirs");
        args.push(`"${[...new Set(uris.map((uri) => dirname(fileURLToPath(uri))))].join(",")}"`);
      }
      args.push("-c");
      args.push(`"${fileURLToPath(uri)}"`);

      let stdout = "";
      let stderr = "";

      if (verbose) {
        this.server.logger.info(this.getExecutablePath(os));
        this.server.logger.info(JSON.stringify(args, null, 4));
      }

      const child = spawn(join(__dirname, this.getExecutablePath(os)), args, { shell: true });

      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (e: any) => {
        this.server.logger.error(e.message);
        reject(e);
      });

      child.on("close", (_) => {
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
              return this.server.logger.error(
                "Unable to resolve provided Neverwinter Nights home and/or installation directories. Ensure the paths are valid in the extension settings.",
              );
            } else {
              return this.server.logger.error(
                "Unable to automatically resolve Neverwinter Nights home and/or installation directories.",
              );
            }
          }
        });

        if (verbose) {
          this.server.logger.info("Done.\n");
        }

        uris.push(document.uri);
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
