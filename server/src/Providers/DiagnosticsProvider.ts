import { spawn } from "child_process";
import { type } from "os";
import { join, dirname, basename } from "path";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { ServerManager } from "../ServerManager";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import Provider from "./Provider";

const lineNumber = /\(([^)]+)\)/;
const lineMessage = /Error:(.*)/;
const lineFilename = /^[^\(]+/;

enum OS {
  linux = "Linux",
  mac = "Darwin",
  windows = "Windows_NT",
}

type FilesDiagnostics = { [uri: string]: Diagnostic[] };
export default class DiagnoticsProvider extends Provider {
  constructor(server: ServerManager) {
    super(server);

    this.server.liveDocumentsManager.onDidSave((event) => this.asyncExceptionsWrapper(this.publish(event.document.uri)));
    this.server.liveDocumentsManager.onDidOpen((event) => this.asyncExceptionsWrapper(this.publish(event.document.uri)));
  }

  private sendDiagnostics(uri: string, diagnostics: Diagnostic[]) {
    this.server.connection.sendDiagnostics({ uri, diagnostics });
  }

  private generateDiagnostic(paths: string[], files: FilesDiagnostics, severity: DiagnosticSeverity) {
    return (line: string) => {
      const path = paths.find((path) => basename(path) === lineFilename.exec(line)![0]);

      if (path) {
        const fileUri = WorkspaceFilesSystem.filePathToUri(path).toString();
        const linePosition = Number(lineNumber.exec(line)![1]) - 1;
        const diagnostic = {
          severity: severity,
          range: {
            start: { line: linePosition, character: 0 },
            end: { line: linePosition, character: Number.MAX_VALUE },
          },
          message: lineMessage.exec(line)![1].trim(),
        };

        files[fileUri].push(diagnostic);
      }
    };
  }

  private hasSupportedOS() {
    return ([...Object.values(OS).filter((item) => isNaN(Number(item)))] as string[]).includes(type());
  }

  private getExecutablePath() {
    switch (type()) {
      case OS.linux:
        return "../../resources/compiler/linux/nwnsc";
      case OS.mac:
        return "../../resources/compiler/mac/nwnsc";
      case OS.windows:
        return "../../resources/compiler/windows/nwnsc.exe";
      default:
        return "";
    }
  }

  private publish(uri: string) {
    return async () => {
      return new Promise((resolve, reject) => {
        const { enabled, nwnHome, nwnInstallation, verbose } = this.server.config.compiler;
        if (!enabled) {
          return reject();
        }

        if (!this.hasSupportedOS()) {
          this.server.logger.error("Unsupported OS. Cannot provide diagnostics.");
          return reject();
        }

        const path = WorkspaceFilesSystem.fileUriToPath(uri);
        const documentKey = WorkspaceFilesSystem.getFileBasename(path);
        const document = this.server.documentsCollection?.get(documentKey);

        if (!this.server.hasIndexedDocuments || !document) {
          if (!this.server.documentsWaitingForPublish.includes(uri)) {
            this.server.documentsWaitingForPublish?.push(uri);
          }
          return resolve(true);
        }

        const children = document.getChildren();
        const files: FilesDiagnostics = { [WorkspaceFilesSystem.filePathToUri(document.path).toString()]: [] };
        const paths: string[] = [];
        children.forEach((child) => {
          const filePath = this.server.documentsCollection?.get(child)?.path;
          if (filePath) {
            files[WorkspaceFilesSystem.filePathToUri(filePath).toString()] = [];
            paths.push(filePath);
          }
        });

        if (verbose) {
          this.server.logger.info(`Compiling ${basename(document.path)}:`);
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
          args.push(`"${[...new Set(paths.map((path) => dirname(path)))].join(";")}"`);
        }
        args.push(`"${path}"`);

        let stdout = "";
        let stderr = "";

        const child = spawn(join(__dirname, this.getExecutablePath()), args, { shell: true });

        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));

        child.on("error", (e: any) => {
          this.server.logger.error(e.message);
          reject();
        });

        child.on("close", (_) => {
          try {
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
              if (line.includes("Warning:")) {
                warnings.push(line);
              }

              // Actual errors
              if (line.includes("NOTFOUND")) {
                return this.server.logger.error(
                  "Unable to resolve nwscript.nss. Are your Neverwinter Nights home and/or installation directories valid?"
                );
              }
              if (line.includes("Failed to open .key archive")) {
                return this.server.logger.error(
                  "Unable to open nwn_base.key Is your Neverwinter Nights installation directory valid?"
                );
              }
              if (line.includes("Unable to read input file")) {
                if (Boolean(nwnHome) || Boolean(nwnInstallation)) {
                  return this.server.logger.error(
                    "Unable to resolve provided Neverwinter Nights home and/or installation directories. Ensure the paths are valid in the extension settings."
                  );
                } else {
                  return this.server.logger.error(
                    "Unable to automatically resolve Neverwinter Nights home and/or installation directories."
                  );
                }
              }
            });

            if (verbose) {
              this.server.logger.info("Done.\n");
            }

            paths.push(document.path);
            errors.forEach(this.generateDiagnostic(paths, files, DiagnosticSeverity.Error));
            warnings.forEach(this.generateDiagnostic(paths, files, DiagnosticSeverity.Warning));

            for (const [uri, diagnostics] of Object.entries(files)) {
              this.sendDiagnostics(uri, diagnostics);
            }
            resolve(true);
          } catch (e: any) {
            this.server.logger.error(e.message);
            reject();
          }
        });
      });
    };
  }

  public async processDocumentsWaitingForPublish() {
    return Promise.all(this.server.documentsWaitingForPublish.map((uri) => this.asyncExceptionsWrapper(this.publish(uri))));
  }
}
