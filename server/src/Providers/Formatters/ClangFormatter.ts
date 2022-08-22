import { spawn } from "child_process";
import { parser, Tag } from "sax";
import { TextDocument, Range, TextEdit } from "vscode-languageserver-textdocument";

import Formatter from "./Formatter";

type CurrentEdit = { length: number; offset: number; text: string };

export default class ClangFormatter extends Formatter {
  edits: TextEdit[] = [];
  currentEdit: CurrentEdit | null = null;

  private xmlParseOnText() {
    return (text: string) => {
      if (!this.currentEdit) {
        return;
      }

      this.currentEdit.text = text;
    };
  }

  private xmlParserOnOpenTag(reject: (reason: any) => void) {
    return (tag: Tag) => {
      if (this.currentEdit) {
        reject(new Error("Malformed output."));
      }

      switch (tag.name) {
        case "replacements":
          return;

        case "replacement":
          this.currentEdit = {
            length: parseInt(tag.attributes.length.toString()),
            offset: parseInt(tag.attributes.offset.toString()),
            text: "",
          };
          break;

        default:
          reject(new Error(`Unexpected tag ${tag.name}.`));
      }
    };
  }

  private xmlParserOnCloseTag(document: TextDocument) {
    return () => {
      if (!this.currentEdit) {
        return;
      }

      const start = document.positionAt(this.currentEdit.offset);
      const end = document.positionAt(this.currentEdit.offset + this.currentEdit.length);

      this.edits.push({ range: { start, end }, newText: this.currentEdit.text });
      this.currentEdit = null;
    };
  }

  public async formatDocument(document: TextDocument, range: Range | null) {
    return await new Promise<TextEdit[] | null>((resolve, reject) => {
      if (!this.enabled || this.isIgnoredFile(document.uri)) {
        return resolve(null);
      }

      if (this.verbose) {
        this.logger.info(`Formatting ${document.uri}:`);
      }

      const args = ["-output-replacements-xml", `-style=${JSON.stringify(this.style)}`];

      if (range) {
        const offset = document.offsetAt(range.start);
        const length = document.offsetAt(range.end) - offset;

        args.push(`-offset=${offset}`, `-length=${length}`);
      }

      let stdout = "";
      let stderr = "";

      if (this.verbose) {
        this.logger.info(`Resolving clang-format's executable with: ${this.executable}.`);
      }

      const child = spawn(this.executable, args, {
        cwd: this.workspaceFilesSystem.getWorkspaceRootPath(),
      });

      child.stdin.end(document.getText());
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (e: any) => {
        this.logger.error(e.message);
        reject(e);
      });

      child.on("close", (code) => {
        if (code !== 0 || stderr.length !== 0) {
          this.logger.error(stderr);
          reject(new Error(stderr));
        }

        const xmlParser = parser(true, {
          trim: false,
          normalize: false,
        });

        xmlParser.onerror = (err) => reject(err);
        xmlParser.ontext = this.xmlParseOnText();
        xmlParser.onopentag = this.xmlParserOnOpenTag(reject);
        xmlParser.onclosetag = this.xmlParserOnCloseTag(document);
        xmlParser.write(stdout);
        xmlParser.end();

        if (this.verbose) {
          this.logger.info("Done.\n");
        }

        resolve(this.edits);
      });
    });
  }
}
