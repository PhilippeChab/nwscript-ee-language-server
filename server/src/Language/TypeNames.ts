export enum BuiltinType {
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

// A declared type can be a built-in name or a user-defined struct name.
export type TypeName = string;

export function isBuiltinType(name: TypeName): name is BuiltinType {
  return Object.prototype.hasOwnProperty.call(BuiltinType, name);
}
