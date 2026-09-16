import assert from "node:assert/strict";
import { before, test } from "node:test";
import { join } from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import SyntaxDocument from "../src/Tokenizer/SyntaxDocument";
import { definitionAt, referencesAt } from "./bindings-providers-poc";
import { BindingModel, example } from "./bindings-poc";

before(async () => await SyntaxDocument.loadGrammar(join(__dirname, "../resources")));

void test("bindings distinguish globals, parameters and nested shadowing and support reference lookup", () => {
  const document = TextDocument.create("file:///example.nss", "nwscript", 1, example);
  const syntax = SyntaxDocument.create(document);
  try {
    const model = new BindingModel(syntax, document);
    const values = model.symbols.filter((symbol) => symbol.declaration.identifier === "value");
    assert.deepEqual(
      values.map((symbol) => symbol.references.map((reference) => document.positionAt(reference.offset).line + 1)),
      [[13], [4, 9], [7]],
    );
    assert.equal(new Set(values.map((symbol) => symbol.id)).size, 3);
    assert.equal(model.symbolAt(example.indexOf("copy = value;", example.indexOf("int value = 2;")) + 7), values[2]);
    assert.equal(model.symbolAt(values[2].offset), values[2]);
    assert.equal(model.references.filter((reference) => !reference.symbol).length, 0);
  } finally {
    syntax.dispose();
  }
});

void test("declarations do not bind earlier uses or leak into sibling blocks", () => {
  const source = "void Fn() { missing = 1; int missing; { int inner; } inner = missing; }";
  const document = TextDocument.create("file:///example.nss", "nwscript", 1, source);
  const syntax = SyntaxDocument.create(document);
  try {
    const model = new BindingModel(syntax, document);
    assert.deepEqual(
      model.references.filter((reference) => !reference.symbol).map((reference) => reference.name),
      ["missing", "inner"],
    );
    assert.equal(
      model.symbolAt(source.lastIndexOf("missing")),
      model.symbols.find((symbol) => symbol.declaration.identifier === "missing"),
    );
  } finally {
    syntax.dispose();
  }
});

void test("a new snapshot rebinds uses after an edit while the old snapshot stays unchanged", () => {
  const source = "int value; void Fn(int value) { value = 1; }";
  const document = TextDocument.create("file:///example.nss", "nwscript", 1, source);
  const syntax = SyntaxDocument.create(document);
  try {
    const old = new BindingModel(syntax, document);
    TextDocument.update(document, [{ text: source.replace("int value)", "int renamed)") }], 2);
    syntax.update(document);
    const next = new BindingModel(syntax, document);
    assert.equal(old.references[0].symbol, old.symbols[1]);
    assert.equal(next.references[0].symbol, next.symbols[0]);
    assert.equal(old.symbols[1].declaration.identifier, "value");
    assert.equal(old.document.getText(), source);
    assert.equal(next.document.version, 2);
  } finally {
    syntax.dispose();
  }
});

void test("definition and references providers use the same binding and exclude shadowed names", () => {
  const document = TextDocument.create("file:///example.nss", "nwscript", 1, example);
  const syntax = SyntaxDocument.create(document);
  try {
    const model = new BindingModel(syntax, document);
    const use = document.positionAt(example.indexOf("copy = value;", example.indexOf("int value = 2;")) + 7);
    assert.deepEqual(definitionAt(model, use), { uri: document.uri, range: { start: { line: 5, character: 12 }, end: { line: 5, character: 12 } } });
    assert.deepEqual(
      referencesAt(model, use, false).map((location) => location.range.start.line + 1),
      [7],
    );
    assert.deepEqual(
      referencesAt(model, use, true).map((location) => location.range.start.line + 1),
      [6, 7],
    );
    assert.equal(definitionAt(model, { line: 2, character: 0 }), undefined);
    assert.deepEqual(referencesAt(model, { line: 2, character: 0 }, true), []);
  } finally {
    syntax.dispose();
  }
});
