import type { Position } from "vscode-languageserver";
import type { DocumentIndex } from "../Parser/contracts";

type LegacyDocumentIndex = Omit<DocumentIndex, "includes"> & { children: string[]; includePositions?: Position[] };

// Bundled data can migrate separately from the parser. Normalize its old format
// once at the JSON boundary; runtime documents use includes and kind.
export default function readDocumentIndex(content: string): DocumentIndex {
  const stored = JSON.parse(content, reviveDeclaration) as DocumentIndex | LegacyDocumentIndex;
  if ("includes" in stored) return stored;
  const { children, includePositions, ...declarations } = stored;
  return { ...declarations, includes: children.map((name, i) => ({ name, ...(includePositions?.[i] ? { position: includePositions[i] } : {}) })) };
}

// Parameters, struct fields and references carry the discriminator too.
export function reviveDeclaration(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "tokenType" in value) {
    const { tokenType, ...declaration } = value as Record<string, unknown>;
    return { ...declaration, kind: tokenType };
  }
  return value;
}
