import { before, describe, it } from "mocha";
import { expect } from "chai";
import { buildServerBundle } from "../scripts/Build";
import { join } from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import type DocumentsCollection from "../src/Documents/DocumentsCollection";
import type SemanticModel from "../src/Language/SemanticModel";
import type Parser from "../src/Language/Parser";
import { DeclarationKind } from "../src/Language";
import type { StandardLibraryDefinitions } from "../src/Language";
import type WorkspaceFilesSystem from "../src/WorkspaceFilesSystem/WorkspaceFilesSystem";
import { workspaceUri } from "./support/fixtures";

describe("Semantic model bindings", () => {
  let api: any;
  let parser: Parser;
  before(async () => {
    const bundle = join(__dirname, "../out/semantic-document-test.js");
    buildServerBundle({
      stdin: {
        contents: `export { default as Parser } from './Language/Parser';
          export { default as Collection } from './Documents/DocumentsCollection';
          export { default as SemanticModel } from './Language/SemanticModel';`,
        resolveDir: join(__dirname, "../src"),
        loader: "ts",
      },
      outfile: bundle,
    });
    api = require(bundle);
    parser = await new api.Parser().loadGrammar();
  });

  function setup(source: string) {
    const collection: DocumentsCollection = new api.Collection();
    const live = TextDocument.create(workspaceUri("semantic.nss"), "nwscript", 1, source);
    let library: StandardLibraryDefinitions = { globalDeclarations: [], structDeclarations: [], includes: [] };
    const document = () => collection.getDocument(live, parser, library);
    return {
      document,
      collection,
      live,
      position: (text: string, last = false) => live.positionAt((last ? live.getText().lastIndexOf(text) : live.getText().indexOf(text)) + 1),
      semantic: () => document().semantic,
      setLibrary: (next: StandardLibraryDefinitions) => {
        library = next;
      },
      index: (filename: string, content: string) =>
        collection.updateDocument(TextDocument.create(workspaceUri(filename), "nwscript", 1, content), parser, { getFilePath: () => null } as unknown as WorkspaceFilesSystem),
    };
  }

  it("shares a symbol between declaration, references and completion while preserving shadowing", () => {
    const fixture = setup("int value; void Fn(int arg) { int value = arg; value = value + 1; { string value; value; } value; }");
    const semantic = fixture.semantic();
    const outer = semantic.resolveAt(fixture.position("value = arg"));
    expect(outer).not.to.equal(undefined);
    expect(semantic.resolveAt(fixture.position("value = value"))).to.equal(outer);
    expect(semantic.resolveAt(fixture.position("value + 1"))).to.equal(outer);
    expect(semantic.resolveAt(fixture.position("value;", true))).to.equal(outer);
    expect(semantic.getCompletions(fixture.position("value = value"), false, 0).symbols.find((symbol) => symbol.declaration.identifier === "value")).to.equal(outer);
    const inner = semantic.resolveAt(fixture.position("value; }"));
    expect(inner).not.to.equal(outer);
    expect(inner?.declaration).to.have.property("valueType", "string");
    expect(semantic.resolveAt(fixture.position("value;"))).not.to.equal(outer);
    expect(semantic.bindAt(fixture.position("value + 1"))).to.equal(semantic.bindAt(fixture.live.positionAt(fixture.live.getText().indexOf("value + 1") + 3)));
  });

  for (const newline of ["\n", "\r\n"]) {
    it(`groups function sites without merging their parameters (${JSON.stringify(newline)})`, () => {
      const fixture = setup(["int Fn(int publicName = 7);", "void Before() { Fn(1); }", "int Fn(int privateName) { return privateName; }", "void After() { Fn(2); }"].join(newline));
      const semantic = fixture.semantic();
      const fn = semantic.resolveAt(fixture.position("Fn(int public"));
      expect(fn).not.to.equal(undefined);
      if (!fn) throw new Error("Expected Fn symbol");
      for (const occurrence of ["Fn(1)", "Fn(int private", "Fn(2)"]) expect(semantic.resolveAt(fixture.position(occurrence))).to.equal(fn);
      expect(fn.declarations).to.have.length(2);
      expect(fn.declaration).to.have.nested.property("params.0.identifier", "publicName");
      expect(semantic.resolveCall(fixture.live.positionAt(fixture.live.getText().indexOf("Fn(2)") + 3))?.symbol).to.equal(fn);
      semantic.getCompletions(fixture.position("Fn(2)"), false, 0);
      expect(semantic.getDefinitionAt(fixture.position("Fn(int public"))?.position).to.deep.equal(fixture.live.positionAt(fixture.live.getText().indexOf("Fn(int private")));
      expect(semantic.getDefinitionAt(fixture.position("Fn(int private"))?.position).to.deep.equal(fixture.live.positionAt(fixture.live.getText().indexOf("Fn(int public")));
      const parameter = semantic.resolveAt(fixture.position("privateName;"));
      expect(parameter).to.equal(semantic.resolveAt(fixture.position("privateName)")));
      expect(parameter).not.to.equal(semantic.resolveAt(fixture.position("publicName")));
    });
  }

  it("binds struct tags and fields independently of same-named values", () => {
    const fixture = setup("int Data; string field; struct Data { int field; }; void Fn() { struct Data item; item.field; }");
    const semantic = fixture.semantic();
    const tag = semantic.resolveAt(fixture.position("Data {"));
    expect(tag?.declaration.kind).to.equal(DeclarationKind.Struct);
    expect(semantic.resolveAt(fixture.position("Data item"))).to.equal(tag);
    expect(semantic.resolveAt(fixture.position("Data;"))).not.to.equal(tag);
    const field = semantic.resolveAt(fixture.position("field; };"));
    expect(field?.declaration).to.have.property("valueType", "int");
    expect(semantic.resolveAt(fixture.position("field; }", true))).to.equal(field);
    expect(semantic.getCompletions(fixture.position("field; }", true), false, 0).symbols.find((symbol) => symbol.declaration.identifier === "field")).to.equal(field);
  });

  it("returns typed function symbols with custom struct parameter and return types", () => {
    const fixture = setup("struct Payload { int value; }; struct Payload Make(struct Payload item); void Fn() { struct Payload value; Make(value); }");
    const call = fixture.semantic().resolveCall(fixture.position("value);"));
    expect(call?.symbol.declaration.returnType).to.equal("Payload");
    expect(call?.symbol.declaration.params[0].valueType).to.equal("Payload");
    expect(call?.symbol.declarations[0].params[0].valueType).to.equal("Payload");
  });

  it("loads external function sites on demand and keeps navigation current after unsaved edits", () => {
    const fixture = setup('#include "helper"\nvoid Fn() { Imported(1); }');
    const source = "int Imported(int publicName);\nint Imported(int bodyName) { return bodyName; }";
    fixture.index("helper.nss", source);
    const helper = TextDocument.create(workspaceUri("helper.nss"), "nwscript", 1, source);
    let reads = 0;
    const document = fixture.collection.getDocument(fixture.live, parser, { includes: [], globalDeclarations: [], structDeclarations: [] }, (uri) => {
      reads++;
      return uri === helper.uri ? helper : undefined;
    });
    const semantic = document.semantic;
    const position = fixture.position("Imported");
    const symbol = semantic.resolveAt(position);
    if (!symbol) throw new Error("Expected the imported function symbol");
    semantic.getCompletions(position, false, 0);
    expect(reads).to.equal(0);
    expect(symbol.declarations.map((declaration) => declaration.position.line)).to.deep.equal([0, 1]);
    expect(reads).to.equal(1);
    expect(semantic.getDefinitionAt(position)).to.deep.equal({ uri: helper.uri, position: helper.positionAt(source.lastIndexOf("Imported")) });
    TextDocument.update(helper, [{ text: "\n" + source }], 2);
    expect(semantic.resolveAt(position)).to.equal(symbol);
    expect(symbol.declarations.map((declaration) => declaration.position.line)).to.deep.equal([1, 2]);
    expect(semantic.getDefinitionAt(position)).to.deep.equal({ uri: helper.uri, position: helper.positionAt(helper.getText().lastIndexOf("Imported")) });
  });

  it("keeps unresolved members unbound and ignores strings and comments", () => {
    const fixture = setup('string x; vector v; void Fn() { (v).x; v.missing; "x"; /* x */ }');
    const semantic = fixture.semantic();
    const unresolved = semantic.bindAt(fixture.position("x; v.missing"));
    expect(unresolved).not.to.equal(undefined);
    expect(unresolved?.symbol).to.equal(undefined);
    expect(semantic.bindAt(fixture.position("x; v.missing"))).to.equal(unresolved);
    expect(semantic.resolveAt(fixture.position("missing"))).to.equal(undefined);
    expect(semantic.bindAt(fixture.position('"x"'))).to.equal(undefined);
    expect(semantic.bindAt(fixture.position("x */"))).to.equal(undefined);
  });

  it("reuses a model until its source index changes, including incomplete edits", () => {
    const fixture = setup("int VALUE; void Fn() { VALUE; }");
    const before = fixture.semantic();
    const indexed = fixture.document();
    expect(indexed.semantic).to.equal(before);
    const original = before.resolveAt(fixture.position("VALUE;", true));
    expect(fixture.semantic()).to.equal(before);
    TextDocument.update(fixture.live, [{ text: fixture.live.getText() }], 2);
    expect(fixture.semantic()).to.equal(before);
    TextDocument.update(fixture.live, [{ text: "string VALUE; void Fn() { VALUE; }\nvoid Unfinished(" }], 3);
    const after = fixture.semantic();
    expect(fixture.document()).to.equal(indexed);
    expect(after).not.to.equal(before);
    expect(after.resolveAt(fixture.position("VALUE;", true))).not.to.equal(original);
    expect(after.resolveAt(fixture.position("VALUE;", true))?.declaration).to.have.property("valueType", "string");
  });

  it("invalidates resolved and unresolved bindings after transitive include changes and deletion", () => {
    const fixture = setup('#include "helper"\nvoid Fn() { VALUE; Added(); }');
    fixture.index("helper.nss", '#include "nested"');
    fixture.index("nested.nss", "int VALUE;");
    const before = fixture.semantic();
    expect(before.resolveAt(fixture.position("VALUE"))?.declaration).to.have.property("valueType", "int");
    expect(before.resolveAt(fixture.position("Added"))).to.equal(undefined);
    fixture.index("unrelated.nss", "int Unrelated;");
    expect(fixture.semantic()).to.equal(before);
    fixture.index("nested.nss", "string VALUE; void Added() {}");
    const after = fixture.semantic();
    expect(after).not.to.equal(before);
    expect(after.resolveAt(fixture.position("VALUE"))?.declaration).to.have.property("valueType", "string");
    expect(after.resolveAt(fixture.position("Added"))?.declaration.kind).to.equal(DeclarationKind.Function);
    fixture.collection.removeDocument(workspaceUri("nested.nss"));
    expect(fixture.semantic().resolveAt(fixture.position("VALUE"))).to.equal(undefined);
  });

  it("rebinds when a missing include appears or the selected API changes", () => {
    const fixture = setup('#include "helper"\nvoid Fn() { VALUE; Api(); }');
    const before = fixture.semantic();
    expect(before.resolveAt(fixture.position("VALUE"))).to.equal(undefined);
    expect(before.resolveAt(fixture.position("Api"))).to.equal(undefined);
    fixture.index("helper.nss", "int VALUE;");
    const included = fixture.semantic();
    expect(included).not.to.equal(before);
    expect(included.resolveAt(fixture.position("VALUE"))?.source?.owner).to.equal(workspaceUri("helper.nss"));
    fixture.setLibrary({ ...parser.indexContent("void Api();"), owner: workspaceUri("nwscript.nss") });
    const apiModel = fixture.semantic();
    expect(apiModel).not.to.equal(included);
    expect(apiModel.resolveAt(fixture.position("Api"))?.source?.owner).to.equal(workspaceUri("nwscript.nss"));
  });

  it("isolates reopened buffers and duplicate basenames", () => {
    const fixture = setup("int VALUE;");
    const before = fixture.semantic();
    const library = { globalDeclarations: [], structDeclarations: [], includes: [] };
    for (const uri of [fixture.live.uri, workspaceUri("other/semantic.nss")]) {
      const reopened = TextDocument.create(uri, "nwscript", 1, "string VALUE;");
      const semantic = fixture.collection.getDocument(reopened, parser, library).semantic;
      expect(semantic).not.to.equal(before);
      expect(semantic.resolveAt({ line: 0, character: 8 })?.declaration).to.have.property("valueType", "string");
    }
  });

  it("distinguishes fields at identical positions in different bundled includes", () => {
    const fixture = setup('#include "first"\n#include "other"\nvoid Fn() { struct First one; struct Other two; one.field; two.field; }');
    const inputs = [fixture.semantic().inputs[0]];
    for (const [file, type] of [
      ["first", "First"],
      ["other", "Other"],
    ]) {
      const index = parser.indexContent(`struct ${type} { int field; };`);
      inputs.push({ uri: `static/${file}`, index });
    }
    const semantic: SemanticModel = new api.SemanticModel(parser.parse(fixture.live), inputs, { getImportCandidates: () => [], getFunctionDeclarations: () => [] });
    const first = semantic.resolveAt(fixture.live.positionAt(fixture.live.getText().indexOf("one.field") + 5));
    const other = semantic.resolveAt(fixture.live.positionAt(fixture.live.getText().indexOf("two.field") + 5));
    expect(first?.declaration.position).to.deep.equal(other?.declaration.position);
    expect(first?.source?.owner).to.equal(undefined);
    expect(other?.source?.owner).to.equal(undefined);
    expect(first).not.to.equal(undefined);
    expect(other).not.to.equal(undefined);
    expect(first).not.to.equal(other);
    expect(first?.source?.uri).to.equal("static/first");
    expect(other?.source?.uri).to.equal("static/other");
  });

  it("shares built-in vector field symbols without inventing a source location", () => {
    const fixture = setup("void Fn() { vector one; vector two; one.x; two.x; }");
    const semantic = fixture.semantic();
    const first = semantic.resolveAt(fixture.live.positionAt(fixture.live.getText().indexOf("one.x") + 4));
    const second = semantic.resolveAt(fixture.live.positionAt(fixture.live.getText().indexOf("two.x") + 4));
    expect(first?.declaration).to.have.property("valueType", "float");
    expect(first).to.equal(second);
    expect(first?.source).to.equal(undefined);
  });
});
