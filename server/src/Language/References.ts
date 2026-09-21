import type { NamedLocation } from "./Declarations";

export enum ReferenceKind {
  Member = "memberReference",
  Type = "typeReference",
}

export type MemberReference = NamedLocation & { kind: ReferenceKind.Member };
export type TypeReference = NamedLocation & { kind: ReferenceKind.Type };
