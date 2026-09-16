import { basename } from "path";
import { fileURLToPath, pathToFileURL } from "url";

// Normalize equivalent percent encodings, including Windows drive colons.
export const normalizeDocumentUri = (uri: string) => pathToFileURL(fileURLToPath(uri)).href;

export const isStandardLibrary = (uri: string) => uri.startsWith("file:") && basename(fileURLToPath(uri)).toLowerCase() === "nwscript.nss";
