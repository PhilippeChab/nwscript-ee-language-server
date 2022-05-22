import { spawn } from "child_process";
import { parser } from "sax";
import { Range } from "vscode-languageserver";
import { TextDocument, TextEdit } from "vscode-languageserver-textdocument";

import { Logger } from "../../Logger";
import { WorkspaceFilesSystem } from "../../WorkspaceFilesSystem";
import Formatter from "./Formatter";

export default class ClangFormatter extends Formatter {
  constructor(
    workspaceFilesSystem: WorkspaceFilesSystem,
    ignoredGlobs: string[],
    executable: string,
    style: { [index: string]: any },
    logger: Logger
  ) {
    super(workspaceFilesSystem, ignoredGlobs, executable, style, logger);
  }

  private getEdits(document: TextDocument, xml: string, codeContent: string) {
    const saxParser = parser(true, {
      trim: false,
      normalize: false,
    });

    const edits: TextEdit[] = [];
    let currentEdit: { length: number; offset: number; text: string } | null;

    saxParser.onerror = (err) => {
      throw err;
    };

    saxParser.onopentag = (tag) => {
      if (currentEdit) {
        throw new Error("Malformed output.");
      }

      switch (tag.name) {
        case "replacements":
          return;

        case "replacement":
          currentEdit = {
            length: parseInt(tag.attributes["length"].toString()),
            offset: parseInt(tag.attributes["offset"].toString()),
            text: "",
          };
          this.byteToOffset(codeContent, currentEdit);
          break;

        default:
          throw new Error(`Unexpected tag ${tag.name}.`);
      }
    };

    saxParser.ontext = (text) => {
      if (!currentEdit) {
        return;
      }

      currentEdit.text = text;
    };

    saxParser.onclosetag = () => {
      if (!currentEdit) {
        return;
      }

      const start = document.positionAt(currentEdit.offset);
      const end = document.positionAt(currentEdit.offset + currentEdit.length);

      edits.push({ range: { start, end }, newText: currentEdit.text });
      currentEdit = null;
    };

    saxParser.write(xml);
    saxParser.end();

    return edits;
  }

  public formatDocument(document: TextDocument, range: Range | null): Promise<TextEdit[] | null> {
    return new Promise((resolve, reject) => {
      const formatCommandBinPath = this.getExecutablePath();
      const codeContent = document.getText();

      const formatArgs = ["-output-replacements-xml", `-style=${JSON.stringify(this.style)}`];

      if (range) {
        const offset = document.offsetAt(range.start);
        const length = document.offsetAt(range.end) - offset;

        formatArgs.push(`-offset=${offset}`, `-length=${length}`);
      }

      let stdout = "";
      let stderr = "";
      const child = spawn(formatCommandBinPath, formatArgs, {
        cwd: this.workspaceFilesSystem.getWorkspaceRootPath(),
      });

      child.stdin.end(codeContent);
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));

      child.on("error", (e: any) => {
        if (e && e.code === "ENOENT") {
          this.logger.error(
            `The ${formatCommandBinPath} command is not available.  Please check your executable setting and ensure clang executable is installed.`
          );
          reject(e);
        } else {
          this.logger.error(e.message);
          reject();
        }
      });

      child.on("close", (code) => {
        try {
          if (code !== 0 || stderr.length !== 0) {
            this.logger.error(stderr);
            reject();
          }

          resolve(this.getEdits(document, stdout, codeContent));
        } catch (e: any) {
          this.logger.error(e.message);
          reject();
        }
      });
    });
  }
}
