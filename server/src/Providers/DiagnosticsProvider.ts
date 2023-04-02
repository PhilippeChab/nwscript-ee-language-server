import { spawn } from "child_process";
import { type } from "os";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";

import { ServerManager } from "../ServerManager";
import Provider from "./Provider";

const lineNumber = /\(([^)]+)\)/;
const lineMessage = /(Error|Warning):(.*)/;
const lineFilename = /^[^(]+/;

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
      const uri = uris.find((uri) => basename(fileURLToPath(uri)) === lineFilename.exec(line)![0]);

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

  private getExecutablePath() {
    switch (type()) {
      case OS.linux:
        return "../resources/compiler/linux/nwnsc";
      case OS.mac:
        return "../resources/compiler/mac/nwnsc";
      case OS.windows:
        return "../resources/compiler/windows/nwnsc.exe";
      default:
        return "";
    }
  }

  public publish(uri: string) {
    return async () => {
      return await new Promise<boolean>((resolve, reject) => {
        const { enabled, nwnHome, reportWarnings, nwnInstallation, verbose } = this.server.config.compiler;
        if (!enabled || uri.includes("nwscript.nss")) {
          return resolve(true);
        }

        if (!this.hasSupportedOS()) {
          const errorMessage = "Unsupported OS. Cannot provide diagnostics.";
          this.server.logger.error(errorMessage);
          return reject(new Error(errorMessage));
        }

        const document = this.server.documentsCollection.getFromUri(uri);

        if (!document) {
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
        // The compiler command:
        //  - y; continue on error
        //  - c; compile includes
        //  - l; try to load resources if paths are not supplied
        //  - r; don't generate the compiled file
        //  - h; game home path
        //  - n; game installation path
        //  - i; includes directories
        const args = ["-y", "-c", "-l", "-r", "SKIP_OUTPUT"];
        if (Boolean(nwnHome)) {
          args.push("-h");
          args.push(`"${nwnHome}"`);
        } else if (verbose) {
          this.server.logger.info("Trying to resolve Neverwinter Nights home directory automatically.");
        }
        if (Boolean(nwnInstallation)) {
          args.push("-n");
          args.push(`"${nwnInstallation}"`);
        } else if (verbose) {
          this.server.logger.info("Trying to resolve Neverwinter Nights installation directory automatically.");
        }
        if (children.length > 0) {
          args.push("-i");
          args.push(`"${[...new Set(uris.map((uri) => dirname(fileURLToPath(uri))))].join(";")}"`);
        }
        args.push(`"${fileURLToPath(uri)}"`);

        let stdout = "";
        let stderr = "";

        const child = spawn(join(__dirname, this.getExecutablePath()), args, { shell: true });

        child.stdout.on("data", (chunk: string) => (stdout += chunk));
        child.stderr.on("data", (chunk: string) => (stderr += chunk));

        child.on("error", (e: any) => {
          this.server.logger.error(e.message);
          reject(e);
        });

        child.on("close", (_) => {
          const lines = stdout
            .toString()
            .split("\n")
            .filter((line) => line !== "\r" && line !== "\n" && Boolean(line));
          const errors: string[] = [];
          const warnings: string[] = [];

          lines.forEach((line) => {
            if (verbose && !line.includes("Compiling:")) {
              this.server.logger.info(line);
            }

            // Diagnostics
            if (line.includes("Error:")) {
              errors.push(line);
            }
            if (reportWarnings && line.includes("Warning:")) {
              warnings.push(line);
            }

            // Actual errors
            if (line.includes("NOTFOUND")) {
              return this.server.logger.error(
                "Unable to resolve nwscript.nss. Are your Neverwinter Nights home and/or installation directories valid?",
              );
            }
            if (line.includes("Failed to open .key archive")) {
              return this.server.logger.error(
                "Unable to open nwn_base.key Is your Neverwinter Nights installation directory valid?",
              );
            }
            if (line.includes("Unable to read input file")) {
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
    };
  }
}
