# Binding model example

This isolated PoC sits on top of the Tree-sitter release PR. It does not replace production resolution or register handlers in the shipped server.

## What changes for a provider?

Today, the variable-definition path in `GotoDefinitionProvider` calls `Provider.resolveSymbol`. That helper obtains cursor context, distinguishes members/types/declaration sites and delegates value lookup to scope and include searches. For an ordinary variable, the final operation is already small:

```ts
const resolved = this.resolveSymbol(uri, position);
if (!resolved?.owner) return;
const target = resolved.token.position;
return { uri: resolved.owner, range: { start: target, end: target } };
```

In the PoC, `bindings-providers-poc.ts` instead consumes a prepared binding snapshot:

```ts
const symbol = model.symbolAt(model.document.offsetAt(position));
if (!symbol) return;
const target = symbol.declaration.position;
return { uri: model.document.uri, range: { start: target, end: target } };
```

The handler barely shrinks. The difference is that name resolution has already happened: `symbolAt` retrieves the symbol attached to that occurrence. The same symbol gives the references provider its result without another scope search:

```ts
const symbol = model.symbolAt(model.document.offsetAt(position));
const uses = symbol?.references;
```

The file includes real LSP definition/references registration, parameterized by a snapshot lookup. The production server does not call it. Functions and their prototype/implementation navigation are deliberately outside this example, so this is not a claim that the full current provider can be replaced by these few lines.

## Run it

From the repository root, after installing the project and parser-tool dependencies:

```sh
yarn --cwd server/tree-sitter demo:bindings
yarn --cwd server/tree-sitter test:bindings
```

The demo prints declarations and reference locations for three different variables named `value`: a global, a function parameter and a nested-block local. Clicking the nested use resolves to the nested declaration. Its reference list excludes the global and parameter uses; the demo prints the resulting rename candidates without editing a file.

The sample, with a `main` calling its functions, compiles with the bundled compiler. Tests cover shadowing, declaration order, block boundaries, unresolved uses, rebuilding after edits, and definition/reference results.

## Model and limits

`BindingModel` reuses the production declaration objects (`ComplexToken`); it does not introduce a second type/parameter representation. It adds scope ownership, snapshot-local symbol identities, occurrence-to-symbol bindings and reverse reference lists. A document edit creates a new model; identities are not stable across snapshots. Models retain source locations and declaration data, not Tree-sitter node handles.

This deliberately small example handles single-file variables and parameters with lexical lookup. It does not implement includes, engine symbols, function bindings, struct member/type bindings, all NWScript namespace conflicts, type inference, incremental semantic invalidation, or safe rename validation. Unresolved references stay unresolved. The position lookup is a linear scan suitable for demonstration, not a performance improvement claim.

A production adoption would need a versioned model cache, those missing language rules, and equivalence tests against existing providers. The benefit demonstrated here is sharing resolved relationships between features; the analysis work is moved into the model, not eliminated.
