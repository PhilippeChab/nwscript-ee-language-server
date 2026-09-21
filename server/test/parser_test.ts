import { TextDocument } from "vscode-languageserver-textdocument";
import { DeclarationKind, ReferenceKind } from "../src/Language";
import type { SyntaxIndex, LocalScope } from "../src/Language";
import { describe, before } from "mocha";
import { expect } from "chai";
import { readFileSync, readdirSync } from "fs";
import { normalize, join } from "path";
import Parser from "../src/Language/Parser";

// Preserve the legacy declaration comparisons; declaration-order metadata is
// exercised by the import behavior tests, including first-signature parameters.
const format = (data: any) => JSON.parse(JSON.stringify(data, (key, value) => (key === "signatureEnd" ? undefined : value)));

describe("Parser", () => {
  let parser: Parser;
  let staticCode: string;
  let staticSyntaxIndex: SyntaxIndex;
  let staticLocalScopeWithContext: LocalScope;
  let staticLocalScopeWithoutContext: LocalScope;

  before("Read static data", async () => {
    parser = await new Parser(true).loadGrammar();
    staticCode = readFileSync(normalize(join(__dirname, "./static/test.nss"))).toString();
    staticSyntaxIndex = JSON.parse(readFileSync(normalize(join(__dirname, "./static/globalScopeTokens.json")), "utf8")) as SyntaxIndex;
    staticLocalScopeWithContext = JSON.parse(readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithContext.json")), "utf8")) as LocalScope;
    staticLocalScopeWithoutContext = JSON.parse(readFileSync(normalize(join(__dirname, "./static/localScopeTokensWithoutContext.json")), "utf8")) as LocalScope;
  });

  it("classifies global and local variables independently of constants", () => {
    const index = parser.indexContent("int Global = 1; const int Fixed = 2; void main() { int local; }");
    expect(index.globalDeclarations[0]).to.include({ kind: DeclarationKind.Variable, scope: "global", value: "1" });
    expect(index.globalDeclarations[1]).to.include({ kind: DeclarationKind.Constant, isConst: true });
    expect(index.localDeclarations?.[0]).to.include({ kind: DeclarationKind.Variable, scope: "local" });
  });

  it("classifies implicit API constants in one-shot and cached live parses", () => {
    const document = TextDocument.create("file:///NWScript.NSS", "nwscript", 1, "int TRUE = 1;");
    const expected = { kind: DeclarationKind.Constant, identifier: "TRUE", value: "1" };
    expect(parser.indexContent(document).globalDeclarations[0]).to.include(expected);
    const syntax = parser.parse(document);
    expect(syntax.getIndex().globalDeclarations[0]).to.include(expected);
    TextDocument.update(document, [{ text: "int TRUE = 2;" }], 2);
    expect(parser.parse(document)).to.equal(syntax);
    expect(syntax.getIndex().globalDeclarations[0]).to.include({ ...expected, value: "2" });
  });

  it("recognizes API resource names independently of the host platform", () => {
    for (const uri of ["file:///nwscript.nss", "file:///C:/scripts/nwscript.nss", "file:///C%3A/scripts/NWScript.NSS", "file://server/share/nwscript.nss", "file:///scripts/nws%63ript.nss"]) {
      const document = TextDocument.create(uri, "nwscript", 1, "int TRUE = 1;");
      expect(parser.parse(document).getIndex(true).globalDeclarations[0].kind, uri).to.equal(DeclarationKind.Constant);
    }
    for (const uri of ["file:///syntax.nss", "file:///C:/scripts/helper.nss", "file://server/share/helper.nss", "untitled:nwscript.nss"]) {
      const document = TextDocument.create(uri, "nwscript", 1, "int Value;");
      expect(parser.parse(document).getIndex(true).globalDeclarations[0].kind, uri).to.equal(DeclarationKind.Variable);
    }
  });

  it("keeps unnamed documents parseable", () => {
    const document = TextDocument.create("untitled:Untitled-1", "nwscript", 1, "int Value;");
    expect(parser.parse(document).getIndex(true).globalDeclarations[0]).to.include({ kind: DeclarationKind.Variable, scope: "global" });
  });

  describe("Global Scope", () => {
    let definitions: SyntaxIndex;
    before("Parse Content", () => {
      definitions = format(parser.indexContent(staticCode));
    });

    it("should equal static includes", () => {
      expect(definitions.includes.map(({ name }) => name)).to.deep.equal(staticSyntaxIndex.includes.map(({ name }) => name));
      staticSyntaxIndex.includes.forEach((include, i) => {
        if (include.position) expect(definitions.includes[i].position).to.deep.equal(include.position);
      });
    });

    it("should equal static struct declarations", () => {
      expect(definitions.structDeclarations).to.be.deep.equal(staticSyntaxIndex.structDeclarations);
    });

    it("should equal static constant and function declarations", () => {
      expect(definitions.globalDeclarations).to.be.deep.equal(staticSyntaxIndex.globalDeclarations);
    });
  });

  describe("Local Scope with current function context", () => {
    let definitions: LocalScope;
    before("Parse Content", () => {
      const syntax = parser.parseContent(staticCode);
      try {
        definitions = format(syntax.getLocalScope({ line: 292, character: Number.MAX_SAFE_INTEGER }));
      } finally {
        syntax.dispose();
      }
    });

    it("should equal static local variable declarations", () => {
      expect(definitions.variableDeclarations).to.be.deep.equal(staticLocalScopeWithContext.variableDeclarations);
    });

    it("should equal static function declarations", () => {
      expect(definitions.functionDeclarations).to.be.deep.equal(staticLocalScopeWithContext.functionDeclarations);
    });
  });

  describe("Local Scope with entire file context", () => {
    let definitions: LocalScope;
    before("Parse Content", () => {
      const syntax = parser.parseContent(staticCode);
      try {
        definitions = format(syntax.getLocalScope());
      } finally {
        syntax.dispose();
      }
    });

    it("should equal static local variable declarations", () => {
      expect(definitions.variableDeclarations).to.be.deep.equal(staticLocalScopeWithoutContext.variableDeclarations);
    });

    it("should equal static function declarations", () => {
      expect(definitions.functionDeclarations).to.be.deep.equal(staticLocalScopeWithoutContext.functionDeclarations);
    });
  });
});

describe("Serialized syntax indexes", () => {
  it("ships current include entries, declaration kinds and variable scopes without conversion", () => {
    const paths = [
      ...["base_scripts", "ovr"].flatMap((folder) => {
        const directory = join(__dirname, "../resources", folder);
        return readdirSync(directory).map((filename) => join(directory, filename));
      }),
      join(__dirname, "../resources/standardLibDefinitions.json"),
      ...["globalScopeTokens", "localScopeTokensWithContext", "localScopeTokensWithoutContext"].map((name) => join(__dirname, "static", name + ".json")),
    ];
    const kinds = [...Object.values(DeclarationKind), ...Object.values(ReferenceKind)];
    for (const path of paths) {
      const stored = JSON.parse(readFileSync(path, "utf8"));
      if ("globalDeclarations" in stored) {
        expect(stored, path).to.have.property("includes").that.is.an("array");
        expect(stored, path).not.to.have.property("children");
        expect(stored, path).not.to.have.property("includePositions");
        for (const declaration of stored.globalDeclarations) {
          if (declaration.kind === DeclarationKind.Variable) expect(declaration.scope, path).to.equal("global");
          if (declaration.kind === DeclarationKind.Constant && path !== join(__dirname, "../resources/standardLibDefinitions.json")) {
            expect(declaration.isConst, path).to.equal(true);
          }
        }
      }
      const visit = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        expect(record, path).not.to.have.property("tokenType");
        if ("kind" in record) expect(kinds, path).to.include(record.kind);
        if (record.kind === DeclarationKind.Variable) expect(["global", "local"], path).to.include(record.scope);
        Object.values(record).forEach(visit);
      };
      visit(stored);
    }
  });
});
