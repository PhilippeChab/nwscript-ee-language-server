import { Position } from "vscode-languageserver";

export function computeIncludeInsertPosition(text: string): Position {
  const lines = text.split("\n");
  let lastIncludeLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#include\s+"[^"]*"/.test(lines[i])) {
      lastIncludeLine = i;
    }
  }

  if (lastIncludeLine === -1) {
    return { line: 0, character: 0 };
  }

  return { line: lastIncludeLine + 1, character: 0 };
}
