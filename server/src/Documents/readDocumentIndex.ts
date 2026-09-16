import { DeclarationKind, ReferenceKind } from "../Parser/types";
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

// Numeric values belong to the legacy serialized format, not the runtime model.
const legacyKinds: Record<number, DeclarationKind | ReferenceKind> = {
  3: DeclarationKind.Function,
  6: DeclarationKind.Variable,
  10: DeclarationKind.Field,
  18: ReferenceKind.Member,
  21: DeclarationKind.Constant,
  22: DeclarationKind.Struct,
  25: DeclarationKind.Parameter,
};

// Parameters, struct fields and references carry the discriminator too.
export function reviveDeclaration(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const stored = value as Record<string, unknown>;
  if ("tokenType" in stored || typeof stored.kind === "number") {
    const { tokenType, kind: storedKind, targetKind, ...declaration } = stored;
    const legacyKind = tokenType ?? storedKind;
    const kind = legacyKind === 18 && targetKind === "struct" ? ReferenceKind.Type : typeof legacyKind === "number" ? legacyKinds[legacyKind] : undefined;
    if (!kind) throw new Error(`Unknown serialized declaration kind: ${String(legacyKind)}`);
    return { ...declaration, kind };
  }
  return value;
}
