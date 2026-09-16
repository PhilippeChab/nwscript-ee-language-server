import type { Parser, Tree, Node } from "web-tree-sitter";
import { LanguageTypes } from "./constants";

const declarationStarts = new Set<string>([...Object.values(LanguageTypes), "const"]);
const isNode = (node: Node | null): node is Node => node !== null;

// A damaged parameter list can consume the next function's signature. Only
// resynchronize at a declaration independently recognized by the same grammar.
// Keep offsets and line endings intact, and leave an ERROR marker for strict
// indexing. No synthetic declarations enter the symbol index.
export function recoverDeclarations(parser: Parser, initial: Tree, source: string): Tree {
  if (!initial.rootNode.hasError) return initial;
  let tree = initial;
  let text = source;
  for (;;) {
    const restarts: { start: number; end: number }[] = [];
    for (const fn of tree.rootNode.namedChildren.filter(isNode).filter((node) => node.type === "function_definition")) {
      const signature = fn.namedChildren.filter(isNode).find((node) => node.type === "function_argument_list" && node.hasError);
      if (!signature) continue;
      for (const candidate of signature.descendantsOfType(["primitive_type", "void_type", "nwn_type", "struct_specifier", "const_qualifier", "identifier"]).filter(isNode)) {
        if (!declarationStarts.has(candidate.text) && candidate.type !== "struct_specifier") continue;
        const suffix = parser.parse(text.slice(candidate.startIndex, fn.endIndex));
        if (!suffix) continue;
        const declaration = suffix.rootNode.firstNamedChild;
        const valid = declaration?.startIndex === 0 && !declaration.hasError && ["function_definition", "declaration", "struct_declarator"].includes(declaration.type);
        suffix.delete();
        if (valid) {
          restarts.push({ start: fn.startIndex, end: candidate.startIndex });
          break;
        }
      }
    }
    if (!restarts.length) return tree;
    for (const restart of restarts) {
      const prefix = text
        .slice(restart.start, restart.end)
        .split("")
        .map((char, index) => (index === 0 ? "@" : char === "\r" || char === "\n" ? char : " "))
        .join("");
      text = text.slice(0, restart.start) + prefix + text.slice(restart.end);
    }
    const recovered = parser.parse(text);
    if (!recovered) return tree;
    tree.delete();
    tree = recovered;
  }
}
