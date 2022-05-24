import { GlobSync } from "glob";
import { normalize, join } from "path";
import { exit } from "process";

import { Tokenizer } from "../Tokenizer";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { FILES_EXTENSION } from "../WorkspaceFilesSystem/WorkspaceFilesSystem";

const rootPath = process.argv[2];

const generateTokens = async () => {
  const filePaths = new GlobSync(`**/*.${FILES_EXTENSION}`).found.map((filename) => normalize(join(rootPath, filename)));
  const tokenizer = await new Tokenizer().loadGrammar();

  const result = filePaths.map((filePath) => {
    const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();
    const globalScope = tokenizer.tokenizeContent(fileContent, TokenizedScope.global);

    return { filePath, globalScope };
  });

  (process as any).send(JSON.stringify(result));

  exit(0);
};

generateTokens();
