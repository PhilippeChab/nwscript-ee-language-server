import { GlobSync } from "glob";
import { normalize, join } from "path";
import { exit } from "process";
import { Request } from "zeromq";

import { Tokenizer } from "../Tokenizer";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { FILES_EXTENSION } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";

const rootPath = process.argv[2];
const sock = new Request();

const generateTokens = async () => {
  sock.connect("tcp://127.0.0.1:3001");

  const filePaths = new GlobSync(`**/*.${FILES_EXTENSION}`).found.map((filename) => normalize(join(rootPath, filename)));
  const tokenizer = await new Tokenizer().loadGrammar();

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    if (filePath.includes("nwscript.nss")) {
      continue;
    }

    const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();
    const globalScope = tokenizer.tokenizeContent(fileContent, TokenizedScope.global);

    if (process.send) {
      await sock.send(JSON.stringify({ filePath, globalScope }));
      await sock.receive();
    }
  }

  sock.close();
  exit(0);
};

generateTokens();
