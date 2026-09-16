import type { Connection, Location, Position } from "vscode-languageserver";
import type { BindingModel } from "./bindings-poc";

// Model snapshots are prepared/cached outside providers, once per document version.
export function definitionAt(model: BindingModel, position: Position): Location | undefined {
  const symbol = model.symbolAt(model.document.offsetAt(position));
  if (!symbol) return;
  const target = symbol.declaration.position;
  return { uri: model.document.uri, range: { start: target, end: target } };
}

export function referencesAt(model: BindingModel, position: Position, includeDeclaration: boolean): Location[] {
  const symbol = model.symbolAt(model.document.offsetAt(position));
  if (!symbol) return [];
  const offsets = symbol.references.map((reference) => reference.offset);
  if (includeDeclaration) offsets.unshift(symbol.offset);
  return offsets.map((offset) => ({
    uri: model.document.uri,
    range: { start: model.document.positionAt(offset), end: model.document.positionAt(offset + symbol.declaration.identifier.length) },
  }));
}

// Real LSP handler wiring, intentionally not registered by the production server.
export function registerBindingProviders(connection: Pick<Connection, "onDefinition" | "onReferences">, modelFor: (uri: string) => BindingModel | undefined) {
  connection.onDefinition(({ textDocument, position }) => {
    const model = modelFor(textDocument.uri);
    return model ? definitionAt(model, position) : undefined;
  });
  connection.onReferences(({ textDocument, position, context }) => {
    const model = modelFor(textDocument.uri);
    return model ? referencesAt(model, position, context.includeDeclaration) : [];
  });
}
