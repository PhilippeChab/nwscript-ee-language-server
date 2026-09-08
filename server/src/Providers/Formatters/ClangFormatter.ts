/*!
 * NWScript EE Language Server
 * Copyright (c) 2022-2026 Philippe Chabot and contributors
 * https://github.com/PhilippeChab/nwscript-ee-language-server
 * Licensed under GPL-3.0-only with the additional terms in the root NOTICE file.
 */

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

      this.currentEdit.text += text;
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

  private xmlParserOnCloseTag(document: TextDocument, utf8Source: Buffer) {
    return () => {
      if (!this.currentEdit) {
        return;
      }

      // clang-format reports UTF-8 bytes; TextDocument positions use UTF-16.
      const start = document.positionAt(utf8Source.subarray(0, this.currentEdit.offset).toString("utf8").length);
      const end = document.positionAt(utf8Source.subarray(0, this.currentEdit.offset + this.currentEdit.length).toString("utf8").length);

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

      const text = document.getText();
      const utf8Source = Buffer.from(text, "utf8");
      const args = ["-output-replacements-xml", `-style=${JSON.stringify(this.style)}`];

      if (range) {
        const offset = Buffer.byteLength(text.slice(0, document.offsetAt(range.start)), "utf8");
        const length = Buffer.byteLength(document.getText(range), "utf8");

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

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdin.end(utf8Source);
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
          return;
        }

        const xmlParser = parser(true, {
          trim: false,
          normalize: false,
        });

        xmlParser.onerror = (err) => reject(err);
        xmlParser.ontext = this.xmlParseOnText();
        xmlParser.onopentag = this.xmlParserOnOpenTag(reject);
        xmlParser.onclosetag = this.xmlParserOnCloseTag(document, utf8Source);
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
