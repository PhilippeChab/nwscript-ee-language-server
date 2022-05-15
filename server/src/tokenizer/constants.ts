export enum LanguageTypes {
  int = "int",
  string = "string",
  object = "object",
  struct = "struct",
  action = "action",
  effect = "effect",
  event = "event",
  float = "float",
  itemproperty = "itemproperty",
  location = "location",
  talent = "talent",
  vector = "vector",
  void = "void",
  json = "json",
  sqlquery = "sqlquery",
  cassowary = "cassowary",
  none = "none",
}

export const INCLUDE_SCOPE = "meta.preprocessor.include.nss";
export const FUNCTION_SCOPE = "meta.function.nss";
export const FUNCTION_PARAMETER_SCOPE = "variable.parameter.nss";
export const BLOCK_SCOPE = "meta.block.nss";
export const STRUCT_SCOPE = "storage.type.struct-defined.nss";
export const VARIABLE_SCOPE = "variable.language.nss";
export const CONSTANT_SCOPE = "constant.language.nss";
export const TYPE_SCOPE = "storage.type.built-in.nss";

export const TERMINATOR_STATEMENT = "punctuation.terminator.statement.nss";
export const DOT_ACCESS_STATEMENT = "	punctuation.separator.dot-access.nss";

export const FUNCTION_DECLARACTION_SCOPE = "entity.name.function.nss";
export const BLOCK_DECLARACTION_SCOPE = "punctuation.section.block.begin.bracket.curly.nss";
export const BLOCK_TERMINATION_SCOPE = "punctuation.section.block.end.bracket.curly.nss";
