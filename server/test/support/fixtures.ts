import { resolve } from "path";
import { pathToFileURL } from "url";

export const workspaceUri = (filename: string) => pathToFileURL(resolve("workspace", filename)).href;
