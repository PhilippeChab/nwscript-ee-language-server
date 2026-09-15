import { fileURLToPath, pathToFileURL } from "url";

// Normalize equivalent percent encodings, including Windows drive colons.
export const normalizeDocumentUri = (uri: string) => pathToFileURL(fileURLToPath(uri)).href;
