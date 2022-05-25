import { exit } from "process";
import { Request } from "zeromq";

import { Tokenizer } from "../Tokenizer";
import { TokenizedScope } from "../Tokenizer/Tokenizer";
import { WorkspaceFilesSystem } from "../WorkspaceFilesSystem";
import { SOCKET_ADRESS } from "../server";

const socket = new Request();
socket.connect(SOCKET_ADRESS);

const generateTokens = async (filesPath: string[]) => {
  const tokenizer = await new Tokenizer().loadGrammar();

  for (let i = 0; i < filesPath.length; i++) {
    const filePath = filesPath[i];
    if (filePath.includes("nwscript.nss")) {
      continue;
    }

    const fileContent = WorkspaceFilesSystem.readFileSync(filePath).toString();
    const globalScope = tokenizer.tokenizeContent(fileContent, TokenizedScope.global);

    await socket.send(JSON.stringify({ filePath, globalScope }));
    await socket.receive();
  }

  socket.close();
  exit(0);
};

process.on("message", (filesPath: string) => {
  generateTokens(filesPath.split(","));
});
