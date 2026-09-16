import { fileURLToPath, pathToFileURL } from "url";

// Normalize equivalent percent encodings, including Windows drive colons.
export const normalizeDocumentUri = (uri: string) => pathToFileURL(fileURLToPath(uri)).href;

// Identify the resource from its URI without requiring a host-native disk path.
export const isStandardLibrary = (uri: string) => uri.startsWith("file:") && decodeURIComponent(new URL(uri).pathname.split("/").pop() || "").toLowerCase() === "nwscript.nss";
