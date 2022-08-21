import { spawn } from "child_process";
import { parser, Tag } from "sax";
import { Range } from "vscode-languageserver";
import { TextDocument, TextEdit } from "vscode-languageserver-textdocument";

import Formatter from "./Formatter";

type CurrentEdit = { length: number; offset: number; text: string } | null;
export default class ClangFormatter extends Formatter {
  private xmlParseOnText(currentEdit: CurrentEdit) {
    return (text: string) => {
      if (!currentEdit) {
        return;
      }

      currentEdit.text = text;
    };
  }

  private xmlParserOnOpenTag(currentEdit: CurrentEdit, reject: (reason: any) => void) {
    return (tag: Tag) => {
      if (currentEdit) {
        reject(new Error("Malformed output."));
      }

      switch (tag.name) {
        case "replacements":
          return;

        case "replacement":
          currentEdit = {
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

  private xmlParserOnCloseTag(document: TextDocument, edits: TextEdit[], currentEdit: CurrentEdit) {
    return () => {
      if (!currentEdit) {
        return;
      }

      const start = document.positionAt(currentEdit.offset);
      const end = document.positionAt(currentEdit.offset + currentEdit.length);

      edits.push({ range: { start, end }, newText: currentEdit.text });
      currentEdit = null;
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

      const child = spawn(this.executable, args, { shell: true });

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

        let currentEdit: CurrentEdit = null;
        const edits: TextEdit[] = [];
        const xmlParser = parser(true, {
          trim: false,
          normalize: false,
        });

        xmlParser.onerror = (err) => reject(err);
        xmlParser.ontext = this.xmlParseOnText(currentEdit);
        xmlParser.onopentag = this.xmlParserOnOpenTag(currentEdit, reject);
        xmlParser.onclosetag = this.xmlParserOnCloseTag(document, edits, currentEdit);
        xmlParser.write(stdout);
        xmlParser.end();

        if (this.verbose) {
          this.logger.info("Done.\n");
        }

        resolve(edits);
      });
    });
  }
}
