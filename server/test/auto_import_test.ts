import { workspaceUri } from "./support/fixtures";
import { before, describe, it } from "mocha";
import { expect } from "chai";
import { buildSync } from "esbuild";
import { join } from "path";
import { readFileSync } from "fs";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItem } from "vscode-languageserver";

describe("Auto-import completion", function () {
  this.timeout(10000);
  let api: any;
  let tokenizer: any;
  before(async () => {
    const bundle = join(__dirname, "../out/auto-import-test.js");
    buildSync({
      stdin: {
        contents: `export { default as Collection } from './Documents/DocumentsCollection';
          export { Tokenizer } from './Tokenizer';
          export { default as Completion } from './Providers/CompletionItemsProvider';
          export { defaultServerConfiguration as config } from './ServerManager/Config';`,
        resolveDir: join(__dirname, "../src"),
        loader: "ts",
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
    });
    api = require(bundle);
    tokenizer = await new api.Tokenizer().loadGrammar();
  });

  const complete = (
    source: string,
    scripts: Record<string, string> = {},
    enabled = true,
    indexedSource?: string,
    addParamsToFunctions = true,
    library = { globalDeclarations: [] as any[], structDeclarations: [] as any[] },
  ) => {
    const cursor = source.indexOf("|");
    const text = source.replace("|", "");
    const live = TextDocument.create(workspaceUri("current.nss"), "nwscript", 1, text);
    const collection = new api.Collection();
    for (const [name, content] of Object.entries({ helper: "void Imported(int value);\nconst int IMPORTED_VALUE = 1;\nstruct ImportedStruct {\n int value;\n};\n", ...scripts })) {
      collection.createDocument(workspaceUri(`${name}.nss`), tokenizer.tokenizeContent(content, "document"));
    }
    collection.createDocument(live.uri, tokenizer.tokenizeContent(indexedSource === undefined ? text : indexedSource, "document"));
    const handlers: any = {};
    api.Completion.register({
      documentsCollection: collection,
      tokenizer,
      config: { ...api.config, completion: { autoImport: enabled, addParamsToFunctions } },
      standardLibrary: { get: () => library },
      liveDocumentsManager: { get: () => live },
      logger: {
        error: (message: string) => {
          throw new Error(message);
        },
      },
      connection: {
        onCompletion: (fn: any) => (handlers.complete = fn),
        onCompletionResolve: (fn: any) => (handlers.resolve = fn),
      },
    });
    const request = () => handlers.complete({ textDocument: { uri: live.uri }, position: live.positionAt(cursor) });
    const response = request();
    const items: CompletionItem[] = response.items || response;
    return { items, live, resolve: handlers.resolve, response, request, collection };
  };

  it("does not offer initializer calls as declarations from indexed scripts", () => {
    const { items } = complete("void main() { Fact| }", {
      factory: "int Factory(int value) { return value; }",
      consumer: '#include "factory"\nint FIRST = Factory(1);\nint SECOND = Factory(2);',
    });
    const factories = items.filter((item) => item.label === "Factory");
    expect(factories).to.have.length(1);
    expect(factories[0].additionalTextEdits?.[0].newText).to.equal('#include "factory"\n');
  });

  for (const name of ["main", "StartingConditional"]) {
    for (const declaration of [`const int ${name} = 1;`, `int ${name};`, `struct ${name} { int field; };`]) {
      it(`checks entry points against imported declarations: ${declaration}`, () => {
        const current = name === "main" ? "void main() { Imp| }" : "int StartingConditional() { Imp| return 1; }";
        const { items } = complete(current, { helper: `${declaration}\nvoid Imported() {}` });
        expect(items.some((item) => item.label === "Imported")).to.equal(!declaration.startsWith("const"));
      });
    }
    it(`checks declarations against an imported entry point: ${name}`, () => {
      const entryPoint = name === "main" ? "void main() {}" : "int StartingConditional() { return 1; }";
      const { items } = complete(`int ${name}; void Caller() { Imp| }`, { helper: `${entryPoint}\nvoid Imported() {}` });
      expect(items.some((item) => item.label === "Imported")).to.equal(false);
    });
  }

  it("adds an include after the header and preserves it during function resolution", () => {
    const { items, live, resolve } = complete("// Header\nvoid main()\n{\n Imp|\n}\n");
    const item = items.find((item) => item.label === "Imported");
    expect(item?.detail).to.include('#include "helper"');
    const resolved = resolve(item);
    expect(resolved.label).to.equal("Imported(int value)");
    expect(TextDocument.applyEdits(live, [resolved.textEdit, ...resolved.additionalTextEdits])).to.equal('// Header\n#include "helper"\nvoid main()\n{\n Imported(int value)\n}\n');
    expect(TextDocument.applyEdits(live, resolved.additionalTextEdits)).to.equal('// Header\n#include "helper"\nvoid main()\n{\n Imp\n}\n');
    expect(items.find((item) => item.label === "IMPORTED_VALUE")?.additionalTextEdits).to.have.length(1);
  });

  for (const enabled of [true, false]) {
    for (const unfinished of ["void Unfinished(", "void Unfinished(\n int value,\n", "struct Unfinished {\n int ", "struct Unfinished {\n int field;\n float ", "const int "]) {
      it(`preserves completions before an unfinished declaration with autoImport=${String(enabled)}: ${JSON.stringify(unfinished)}`, () => {
        const valid = "const int IMPORTED_VALUE = 2;\nvoid Existing();\nvoid main()\n{\n int localValue;\n |\n}\n";
        const { items } = complete(valid + unfinished, { helper: "void Imported(int value);" }, enabled, valid.replace("|", ""));
        for (const name of ["Existing", "localValue", "IMPORTED_VALUE"]) {
          expect(
            items.some((item) => item.label === name),
            name,
          ).to.equal(true);
          expect(items.find((item) => item.label === name)).not.to.have.property("additionalTextEdits");
        }
        expect(items.some((item) => item.label === "Imported" && item.additionalTextEdits)).to.equal(enabled);
      });
    }
  }

  it("retains valid globals at every editing prefix of trailing declarations", () => {
    const valid = '#include "helper"\nconst int VISIBLE = 1;\nvoid Existing();\nvoid main() {}\n';
    for (const declaration of ["struct Example {\n int field;\n float other;\n};", 'void Example(\n int value,\n string text = "value");', "const int EXAMPLE = 1;"]) {
      for (let length = 0; length <= declaration.length; length++) {
        const scope = tokenizer.parseContent(valid + declaration.slice(0, length)).getIndex();
        expect(scope.children).to.deep.equal(["helper"]);
        expect(scope.entryPointDeclarations.map((declaration: any) => declaration.identifier)).to.deep.equal(["main"]);
        expect(scope.globalDeclarations.map((token: any) => token.identifier)).to.include.members(["VISIBLE", "Existing"]);
      }
    }
  });

  it("resumes after an incomplete struct field and keeps strict indexing unchanged", () => {
    const source = "struct Example {\n int first;\n int \n float last;\n};\nconst int AFTER = 1;\n";
    const scope = tokenizer.parseContent(source).getIndex();
    expect(scope.structDeclarations[0].properties.map((token: any) => token.identifier)).to.deep.equal(["first", "last"]);
    expect(scope.globalDeclarations.map((token: any) => token.identifier)).to.deep.equal(["AFTER"]);
    expect(() => tokenizer.tokenizeContent(source, "document")).to.throw();
  });

  it("imports function implementations without requiring prototypes and deduplicates paired declarations", () => {
    for (const helper of ["void Imported() {}", "void Imported();\nvoid Imported() {}\n"]) {
      const { items } = complete("void main() {\n Imp|\n}\n", { helper });
      expect(items.filter((item) => item.label === "Imported")).to.have.length(1);
      expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
    }
  });

  for (const [helper, offered] of [
    ["void Imported(int Imported) {}", true],
    ["void Imported(int Imported);", true],
    ["void Imported(int Imported); void Imported(int n) {}", true],
    ["void Imported(int n); void Imported(int Imported) {}", false],
    ["void Imported(int Imported); void Imported(int Imported) {}", false],
    ["void Imported() { int Imported; }", false],
  ] as const) {
    it(`reserves function names after their first signature: ${helper}`, () => {
      const { items } = complete("void main() { Imp| }", { helper });
      expect(items.some((item) => item.label === "Imported")).to.equal(offered);
    });
  }

  for (const conflict of ["const int COLLISION = 1;", "struct Collision {\n int value;\n};", "void Collision() {}", "int Collision(int n);"]) {
    it(`rejects an import introducing a different conflicting declaration: ${conflict}`, () => {
      const local = conflict.startsWith("int Collision") ? "float Collision(int n);" : conflict;
      for (const transitive of [false, true]) {
        const scripts = { helper: `${transitive ? '#include "dependency"' : conflict}\nvoid Imported() {}\n`, dependency: conflict };
        const { items } = complete(`${local}\nvoid main() {\n Imp|\n}\n`, scripts);
        expect(items.some((item) => item.label === "Imported")).to.equal(false);
      }
    });
  }

  for (const [current, imported] of [
    ["int Foo;", "struct Foo { int value; };"],
    ["struct Foo { int value; };", "int Foo;"],
  ]) {
    for (const transitive of [false, true]) {
      it(`keeps struct tags separate from values: ${current} / ${imported} (transitive=${String(transitive)})`, () => {
        const { items } = complete(`${current}\nvoid main() {\n Imp|\n}`, {
          helper: `${transitive ? '#include "dependency"' : imported}\nvoid Imported() {}`,
          dependency: imported,
        });
        expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
      });
    }
  }

  it("allows a struct and value with the same name among newly introduced dependencies", () => {
    const { items } = complete("void main() {\n Imp|\n}", {
      helper: '#include "dependency"\nstruct Foo { int value; };\nvoid Imported() {}',
      dependency: "int Foo;",
    });
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  for (const declaration of ["const int Foo = 1;", "void Foo() {}"]) {
    it(`preserves struct-name conflicts with reserved identifiers: ${declaration}`, () => {
      const { items } = complete("struct Foo { int value; };\nvoid main() {\n struct Foo value;\n Imp|\n}", {
        helper: `${declaration}\nvoid Imported() {}`,
      });
      expect(items.some((item) => item.label === "Imported")).to.equal(false);
    });
  }

  it("still rejects a variable/function collision in the value namespace", () => {
    const { items } = complete("int Foo;\nvoid main() {\n Imp|\n}", { helper: "void Foo() {}\nvoid Imported() {}" });
    expect(items.some((item) => item.label === "Imported")).to.equal(false);
  });

  for (const bundled of [true, false]) {
    for (const transitive of [true, false]) {
      it(`reserves API constants without a const modifier (bundled=${String(bundled)}, transitive=${String(transitive)})`, () => {
        const library = bundled ? JSON.parse(readFileSync(join(__dirname, "../resources/standardLibDefinitions.json"), "utf8")) : tokenizer.tokenizeContent("int TRUE = 1;", "document");
        expect(library.globalDeclarations.find((token: any) => token.identifier === "TRUE").isConst).to.equal(undefined);
        const { items } = complete(
          "void main() {\n Imp|\n}",
          {
            helper: `${transitive ? '#include "dependency"' : "struct TRUE { int value; };"}\nvoid Imported() {}`,
            dependency: "struct TRUE { int value; };",
            safe: "void ImportedSafe() {}",
          },
          true,
          undefined,
          false,
          library,
        );
        expect(items.some((item) => item.label === "Imported")).to.equal(false);
        expect(items.find((item) => item.label === "ImportedSafe")?.additionalTextEdits).to.have.length(1);
      });
    }
  }

  for (const transitive of [false, true]) {
    for (const implementation of [false, true]) {
      it(`treats implicit API functions as engine implementations (transitive=${String(transitive)}, body=${String(implementation)})`, () => {
        const library = tokenizer.tokenizeContent("int IntFn(int n);", "document");
        const declaration = `int IntFn(int n)${implementation ? " { return n; }" : ";"}`;
        const { items } = complete(
          "void main() { Imp| }",
          {
            helper: `${transitive ? '#include "dependency"' : declaration}\nvoid Imported() {}`,
            dependency: declaration,
            safe: "void ImportedSafe() {}",
          },
          true,
          undefined,
          false,
          library,
        );
        expect(items.some((item) => item.label === "Imported")).to.equal(!implementation);
        expect(items.some((item) => item.label === "ImportedSafe")).to.equal(true);
      });
    }
  }

  it("retains conflict metadata for the reported nw_i0_plot declarations", () => {
    const source = "void main() { plotCan| }";
    const offersPlot = (text: string) => complete(text).items.some((item) => item.detail?.includes('#include "nw_i0_plot"'));
    expect(offersPlot(source)).to.equal(true);
    expect(offersPlot("struct DC_EASY { int field; };\n" + source)).to.equal(false);
    expect(offersPlot("int plotCanRemoveXP(object oPC, int nPenalty) { return 1; }\n" + source)).to.equal(false);
  });

  for (const source of [
    "void main() { int VALUE = 2; Imp| }",
    "void Caller(int VALUE) { Imp| }",
    "void Caller(int VALUE); void main() { Imp| }",
    "void main() { Imp| int VALUE = 2; }",
    "void main() { Imp| } void Other() { int VALUE = 2; }",
    "struct Data { int VALUE; }; void main() { Imp| }",
    "struct Data { int first, VALUE; }; void main() { Imp| }",
    "void main() { Imp| } struct Data { int VALUE; };",
  ]) {
    for (const declaration of ["const int VALUE = 1;", "void VALUE() {}", "int VALUE;"]) {
      for (const transitive of [false, true]) {
        it(`checks local reserved names: ${source}, ${declaration}, transitive=${String(transitive)}`, () => {
          const { items } = complete(source, {
            helper: `${transitive ? '#include "dependency"' : declaration}\nvoid Imported() {}`,
            dependency: declaration,
            safe: "void ImportedSafe() {}",
          });
          expect(items.some((item) => item.label === "Imported")).to.equal(declaration === "int VALUE;");
          expect(items.some((item) => item.label === "ImportedSafe")).to.equal(true);
        });
      }
    }
  }

  for (const declaration of ["const int VALUE = 1;", "void VALUE() {}", "int VALUE;"]) {
    for (const transitive of [false, true]) {
      it(`protects field accesses from earlier includes: ${declaration}, transitive=${String(transitive)}`, () => {
        const { items } = complete('#include "existing"\nvoid main() { struct Data d; d.VALUE = 2; Imp| }', {
          existing: "struct Data { int VALUE; };",
          helper: `${transitive ? '#include "dependency"' : declaration}\nvoid Imported() {}`,
          dependency: declaration,
        });
        expect(items.some((item) => item.label === "Imported")).to.equal(declaration !== "const int VALUE = 1;");
      });
    }
  }

  for (const reserved of ["const int COLLIDE = 1;", "int COLLIDE() { return 1; }"]) {
    for (const scoped of [
      "struct Data { int COLLIDE; };",
      "void Local() { int COLLIDE; }",
      "void Local(int COLLIDE) {}",
      "void Local(int COLLIDE);",
      "void Local(int different); void Local(int COLLIDE) {}",
    ]) {
      for (const placement of ["earlierInclude", "laterDeclaration", "api"]) {
        for (const transitive of [false, true]) {
          it(`checks incoming scoped names against ${placement}: ${reserved}, ${scoped}, transitive=${String(transitive)}`, () => {
            const library = tokenizer.tokenizeContent(placement === "api" ? reserved.replace("const ", "") : "", "document");
            const { items } = complete(
              `${placement === "earlierInclude" ? '#include "existing"' : placement === "laterDeclaration" ? reserved : ""}\nvoid main() { Imp| }`,
              { existing: reserved, helper: `${transitive ? '#include "dependency"' : scoped}\nvoid Imported() {}`, dependency: scoped },
              true,
              undefined,
              false,
              library,
            );
            expect(items.some((item) => item.label === "Imported")).to.equal(placement === "laterDeclaration");
          });
        }
      }
    }
  }

  for (const access of ["", "d.VALUE = 2;", "(d).VALUE = 2;", "d. /* comment */ VALUE = 2;"]) {
    it(`permits constants after earlier fields only when they do not replace an access: ${access}`, () => {
      const { items } = complete(`#include "existing"\nvoid main() { struct Data d; ${access} Imp| }`, {
        existing: "struct Data { int VALUE; };",
        helper: "const int VALUE = 1;\nvoid Imported() {}",
      });
      expect(items.some((item) => item.label === "Imported")).to.equal(!access);
    });
  }

  for (const reserved of ["const int ImportedStruct = 1;", "void ImportedStruct() {}"]) {
    for (const earlier of [false, true]) {
      it(`checks the type use introduced by a struct completion: ${reserved}, earlier=${String(earlier)}`, () => {
        const use = "void main() { struct ImportedS| value; }";
        const { items } = complete(earlier ? `${reserved}\n${use}` : `${use}\n${reserved}`, { helper: "struct ImportedStruct { int field; };" });
        expect(items.some((item) => item.label === "ImportedStruct")).to.equal(!earlier);
      });
    }
  }

  it("permits a struct use in the first signature of a same-named function", () => {
    const { items } = complete("void ImportedStruct(struct ImportedS| value);", { helper: "struct ImportedStruct { int field; };" });
    expect(items.some((item) => item.label === "ImportedStruct")).to.equal(true);
  });

  for (const reserved of ["const int Data = 1;", "void Data() {}", "int Data;"]) {
    for (const use of ["struct Data value;", "void Caller(struct Data value);", "struct Data Caller();", "struct Outer { struct Data value; };"]) {
      it(`protects existing struct type uses: ${reserved}, ${use}`, () => {
        const { items } = complete(`#include "existing"\n${use}\nvoid main() { Imp| }`, { existing: "struct Data { int field; };", helper: `${reserved}\nvoid Imported() {}` });
        expect(items.some((item) => item.label === "Imported")).to.equal(reserved === "int Data;");
      });
    }
  }

  for (const reserved of ["const int COLLIDE = 1;", "int COLLIDE() { return 1; }"]) {
    for (const incoming of ["int COLLIDE;", "struct COLLIDE { int field; }; struct COLLIDE instance;"]) {
      for (const earlierInclude of [false, true]) {
        it(`respects declaration order for ${reserved} and ${incoming}, earlierInclude=${String(earlierInclude)}`, () => {
          const { items } = complete(`${earlierInclude ? '#include "existing"' : reserved}\nvoid main() { Imp| }`, {
            existing: reserved,
            helper: `${incoming}\nvoid Imported() {}`,
          });
          expect(items.some((item) => item.label === "Imported")).to.equal(!earlierInclude);
        });
      }
    }
  }

  for (const ordinary of ["int SHARED;", "struct SHARED { int field; }; struct SHARED instance;"]) {
    for (const reserved of ["const int SHARED = 1;", "int SHARED() { return 1; }"]) {
      for (const reversed of [false, true]) {
        for (const separator of ["\n", " "]) {
          for (const transitive of [false, true]) {
            it(`orders incoming declarations: ${ordinary}, ${reserved}, reversed=${String(reversed)}, separator=${JSON.stringify(separator)}, transitive=${String(transitive)}`, () => {
              const declarations = (reversed ? [reserved, ordinary] : [ordinary, reserved]).join(separator);
              const { items } = complete("void main() { Imp| }", {
                helper: `${transitive ? '#include "dependency"' : declarations}\nvoid Imported() {}`,
                dependency: declarations,
              });
              expect(items.some((item) => item.label === "Imported")).to.equal(!reversed);
            });
          }
        }
      }
    }
  }

  for (const ordinary of ["int SHARED;", "struct SHARED { int field; }; struct SHARED instance;"]) {
    for (const reserved of ["const int SHARED = 1;", "int SHARED() { return 1; }"]) {
      for (const reversed of [false, true]) {
        for (const layout of ["header", "middle", "siblings", "diamond"]) {
          it(`orders split incoming declarations: ${ordinary}, ${reserved}, reversed=${String(reversed)}, layout=${layout}`, () => {
            const [first, second] = reversed ? [reserved, ordinary] : [ordinary, reserved];
            const scripts: Record<string, string> =
              layout === "header"
                ? { helper: `#include "first"\n${second}`, first }
                : layout === "middle"
                ? { helper: `${first}\n#include "second"`, second }
                : {
                    helper: '#include "first"\n#include "second"',
                    first: layout === "diamond" ? '#include "shared"' : first,
                    second: layout === "diamond" ? `#include "shared"\n${second}` : second,
                    shared: first,
                  };
            scripts.helper += "\nvoid Imported() {}";
            const { items } = complete("void main() { Imp| }", scripts);
            expect(items.some((item) => item.label === "Imported")).to.equal(!reversed);
          });
        }
      }
    }
  }

  for (const ordinary of ["int SHARED;", "struct SHARED { int field; }; struct SHARED instance;"]) {
    for (const reserved of ["const int SHARED = 1;", "int SHARED() { return 1; }"]) {
      it(`rejects moving a shared dependency before an existing declaration: ${ordinary}, ${reserved}`, () => {
        const { items } = complete(`${ordinary}\n#include "shared"\nvoid main() { Imp| }`, {
          shared: reserved,
          helper: '#include "shared"\nvoid Imported() {}',
        });
        expect(items.some((item) => item.label === "Imported")).to.equal(false);
      });

      it(`keeps an earlier include before the inserted reserved declaration: ${ordinary}, ${reserved}`, () => {
        const { items } = complete('#include "existing"\nvoid main() { Imp| }', { existing: ordinary, helper: `${reserved}\nvoid Imported() {}` });
        expect(items.some((item) => item.label === "Imported")).to.equal(true);
      });
    }
  }

  it("permits compatible function prototypes and dependencies that are already included", () => {
    const { items } = complete('#include "shared"\nvoid Compatible(int n);\nvoid main() {\n Imp|\n}\n', {
      shared: "const int SHARED = 1;",
      helper: '#include "shared"\nvoid Compatible(int value) {}\nvoid Imported() {}',
    });
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  for (const enabled of [true, false]) {
    it(`preserves locals after an unfinished comma declaration (autoImport=${String(enabled)})`, () => {
      const { items } = complete("void main() {\n int first;\n int next,\n fir|\n}\n", {}, enabled, "void main() {}\n");
      expect(items.some((item) => item.label === "first")).to.equal(true);
    });
  }

  it("preserves CRLF and appends after existing includes", () => {
    const { items, live } = complete('#include "other" // comment\r\n\r\nvoid main()\r\n{\r\n Imp|\r\n}\r\n');
    const edits = items.find((item) => item.label === "Imported")?.additionalTextEdits || [];
    expect(TextDocument.applyEdits(live, edits)).to.include('// comment\r\n#include "helper"\r\n\r\nvoid main()');
  });

  for (const include of ['#include "helper"', '#include "wrapper"', '# include "helper" // trailing comment', '#include "helper" /* trailing comment */']) {
    it(`avoids importing symbols already available through ${include}`, () => {
      const { items } = complete(`${include}\nvoid main()\n{\n Imp|\n}`, { wrapper: '#include "helper"\n' });
      expect(items.filter((item) => item.label === "Imported")).to.have.length(1);
      expect(items.find((item) => item.label === "Imported")).not.to.have.property("additionalTextEdits");
    });
  }

  it("ignores includes inside comments", () => {
    const { items } = complete('/*\n#include "helper"\n*/\nvoid main()\n{\n Imp|\n}');
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  it("uses unsaved include additions and removals without changing the index", () => {
    const plain = "void main()\n{\n Imp|\n}";
    const included = `#include "helper"\n${plain}`;
    const added = complete(included, {}, true, plain.replace("|", ""));
    expect(added.items.filter((item) => item.label === "Imported")).to.have.length(1);
    expect(added.items.find((item) => item.label === "Imported")).not.to.have.property("additionalTextEdits");
    const removed = complete(plain, {}, true, included.replace("|", ""));
    expect(removed.items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  for (const declaration of [
    { source: "const int IMPORTED_VALUE = 42;", identifier: "IMPORTED_VALUE", prefix: "IMPORTED_V" },
    { source: "void Imported(int value);", identifier: "Imported", prefix: "Import" },
    { source: "struct ImportedStruct {\n int localValue;\n};", identifier: "ImportedStruct", prefix: "struct ImportedS" },
  ]) {
    it(`uses the unsaved ${declaration.identifier} declaration instead of a conflicting import`, () => {
      const saved = "void main()\n{\n}\n";
      const source = `${declaration.source}\nvoid main()\n{\n ${declaration.prefix}|\n}\n`;
      const { items } = complete(source, {}, true, saved);
      const matches = items.filter((item) => item.label === declaration.identifier);
      expect(matches).to.have.length(1);
      expect(matches[0]).not.to.have.property("additionalTextEdits");
      expect(matches[0]).not.to.have.property("textEdit");
    });
  }

  it("offers imports again after a global declaration is removed without saving", () => {
    const { items } = complete("void main()\n{\n IMPORTED_V|\n}\n", {}, true, "const int IMPORTED_VALUE = 42;\nvoid main()\n{\n}\n");
    expect(items.find((item) => item.label === "IMPORTED_VALUE")?.additionalTextEdits).to.have.length(1);
  });

  for (const entryPoint of ["void main() {}", "int StartingConditional() { return 1; }"]) {
    it(`excludes all symbols from a source with a conflicting ${entryPoint}`, () => {
      const { items } = complete(
        `void Caller()\n{\n Imp|\n}\n${entryPoint}\n`,
        { executable: `void ImportedFromExecutable();\nconst int EXECUTABLE_VALUE = 1;\n${entryPoint}\n` },
        true,
        "void Caller() {}\n",
      );
      expect(items.some((item) => item.detail?.includes('#include "executable"'))).to.equal(false);
      expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
    });
  }

  it("rejects an entry point after another function on the same line", () => {
    const { items } = complete("void main() {\n Imp|\n}\n", { helper: "void Imported() {} void main() {}" });
    expect(items.some((item: any) => item.label === "Imported")).to.equal(false);
  });

  it("rejects an entry point after a struct closing brace", () => {
    const { items } = complete("void main() {\n Imp|\n}\n", { helper: "void Imported() {}\nstruct Thing {\n int field;\n}; void main() {}" });
    expect(items.some((item) => item.label === "Imported")).to.equal(false);
  });

  it("rejects conflicting later names in a comma-separated declaration", () => {
    const { items } = complete("const int COLLISION = 3;\nvoid main() {\n Imp|\n}", { helper: "void Imported() {}\nconst int FIRST = 1, COLLISION = 2;" });
    expect(items.some((item) => item.label === "Imported")).to.equal(false);
  });

  for (const [name, allowed] of [
    ["abcdefghijklmnop", true],
    ["abcdefghijklmnopq", false],
    ["éééééééé", true],
    ["ééééééééé", false],
  ] as const) {
    it(`respects the compiler's 16-byte resource name limit: ${name}`, () => {
      const { items } = complete("void main() {\n Imp|\n}", { [name]: "void ImportedFromName();" });
      expect(items.some((item) => item.label === "ImportedFromName")).to.equal(allowed);
    });
  }

  it("detects entry point conflicts through includes on both sides", () => {
    const { items } = complete('#include "current_entry"\nvoid Caller()\n{\n Imp|\n}\n', {
      current_entry: "void main() {}\n",
      other_entry: "void main() {}\n",
      executable: '#include "other_entry"\nvoid ImportedFromExecutable();\n',
    });
    expect(items.some((item) => item.label === "ImportedFromExecutable")).to.equal(false);
  });

  it("does not treat an entry point prototype as an implementation", () => {
    const { items } = complete("void main()\n{\n Imp|\n}\n", { helper: "void main();\nvoid Imported(int value);\n" });
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  it("allows a candidate whose entry point comes only from an already included dependency", () => {
    const { items } = complete('#include "shared_entry"\nvoid Caller()\n{\n Imp|\n}\n', {
      shared_entry: "void main() {}\n",
      helper: '#include "shared_entry"\nvoid Imported(int value);\n',
    });
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  it("allows an entry point when the requesting script no longer has one", () => {
    const { items } = complete("void Caller()\n{\n Imp|\n}\n", { helper: "void Imported(int value);\nvoid main() {}\n" }, true, "void main() {}\n");
    expect(items.find((item) => item.label === "Imported")?.additionalTextEdits).to.have.length(1);
  });

  for (const source of ["Imp|", "|", "// Header\nImp|"]) {
    it(`applies a completion and include at the same position in ${JSON.stringify(source)}`, () => {
      const { items, live, resolve } = complete(source);
      const item = resolve(items.find((item) => item.label === "Imported"));
      expect(item.additionalTextEdits).to.equal(undefined);
      expect(TextDocument.applyEdits(live, [item.textEdit])).to.equal(`${source.startsWith("//") ? "// Header\n" : ""}#include "helper"\nImported(int value)`);
    });
  }

  it("replaces the complete identifier at the cursor and respects the parameter setting", () => {
    const { items, live, resolve } = complete("void main()\n{\n Imp|orted\n}", {}, true, undefined, false);
    const item = resolve(items.find((item) => item.label === "Imported"));
    expect(TextDocument.applyEdits(live, [item.textEdit, ...item.additionalTextEdits])).to.equal('#include "helper"\nvoid main()\n{\n Imported\n}');
  });

  it("rejects struct collisions with constants in shipped include indexes", () => {
    const source = "void main() { NuiBind| }";
    expect(complete(source).items.some((item) => item.detail?.includes('#include "nw_inc_nui"'))).to.equal(true);
    const conflicting = "struct NUI_DIRECTION_HORIZONTAL { int value; };\n" + source;
    expect(complete(conflicting).items.some((item) => item.detail?.includes('#include "nw_inc_nui"'))).to.equal(false);
  });

  it("rejects duplicate function bodies from shipped include indexes", () => {
    const declaration = "void ActionPsionicMB(object oTarget)";
    const source = "\nvoid main() { ActionPsionicCharm| }";
    expect(complete(declaration + ";" + source).items.some((item) => item.detail?.includes('#include "inc_mf_combat"'))).to.equal(true);
    expect(complete(declaration + " {}" + source).items.some((item) => item.detail?.includes('#include "inc_mf_combat"'))).to.equal(false);
  });

  it("checks entry points in transitive shipped dependencies", () => {
    const scripts = { helper: '#include "nw_ch_check_1"\nvoid Imported() {}' };
    expect(complete("void main() { Imp| }", scripts).items.some((item) => item.label === "Imported")).to.equal(true);
    expect(complete("int StartingConditional() { Imp| }", scripts).items.some((item) => item.label === "Imported")).to.equal(false);
  });

  it("uses bundled includes and honors workspace overrides", () => {
    const source = "void main()\n{\n ActionPsionic|\n}";
    const bundled = complete(source);
    expect(bundled.items.some((item) => item.detail?.includes('#include "inc_mf_combat"'))).to.equal(true);
    const overridden = complete(source, { inc_mf_combat: "void ActionPsionicWorkspaceHelper();\n" });
    const matching = overridden.items.filter((item) => item.detail?.includes('#include "inc_mf_combat"'));
    expect(matching.map((item) => item.label)).to.deep.equal(["ActionPsionicWorkspaceHelper"]);
  });

  it("does not suggest imports from the current script or implicit nwscript", () => {
    const { items } = complete("void OwnFunction();\nvoid main()\n{\n Imp|\n}", { nwscript: "void ImplicitFunction();\n", "other/current": "void OtherCurrent();\n" });
    expect(items.some((item) => item.detail?.includes('#include "current"') || item.detail?.includes('#include "nwscript"'))).to.equal(false);
  });

  it("offers distinct sources for the same symbol", () => {
    const { items } = complete("void main()\n{\n Imp|\n}", { alternate: "void Imported(int value);\n" });
    expect(items.filter((item) => item.label === "Imported")).to.have.length(2);
  });

  it("does not insert inside a header comment that ends beside code", () => {
    const { items, live } = complete("/* Header\n */ void main()\n{\n Imp|\n}");
    const edits = items.find((item) => item.label === "Imported")?.additionalTextEdits || [];
    expect(TextDocument.applyEdits(live, edits)).to.equal('/* Header\n */\n#include "helper"\n void main()\n{\n Imp\n}');
  });

  it("avoids cycles and local symbol conflicts", () => {
    const { items } = complete("void Imported(int value);\nvoid main()\n{\n Imp|\n}", { cycle: '#include "current"\nvoid Cyclic();\n' });
    expect(items.find((item) => item.label === "Imported")).not.to.have.property("additionalTextEdits");
    expect(items.some((item) => item.label === "Cyclic")).to.equal(false);
  });

  for (const expression of ["// Imp|", "/* Imp| */", 'string s = "Imp|";', "value.Imp|", "value. |", '#include "Imp|"']) {
    it(`suppresses auto-imports in ${expression}`, () => {
      const { items } = complete(`void main()\n{\n ${expression}\n}`);
      expect(items.some((item) => item.additionalTextEdits)).to.equal(false);
    });
  }

  for (const enabled of [true, false]) {
    for (const expression of ['"Imp|"', 'r"Imp|"', 'R"line\nImp|"', 'r"quoted ""Imp|"""', 'r"backslash \\ Imp|"']) {
      it(`suppresses all completions inside ${expression} with autoImport=${String(enabled)}`, () => {
        expect(complete(`void main() { string value = ${expression}; }`, {}, enabled).items).to.deep.equal([]);
      });
    }
  }

  for (const eol of ["\n", "\r\n"]) {
    it(`inserts before existing leading blank lines: ${JSON.stringify(eol)}`, () => {
      const { items, live } = complete(`${eol}${eol}void main() { Imp| }`);
      const item = items.find((candidate) => candidate.label === "Imported");
      expect(item?.additionalTextEdits?.[0].range.start).to.deep.equal({ line: 0, character: 0 });
      expect(TextDocument.applyEdits(live, item?.additionalTextEdits || [])).to.equal(`#include "helper"${eol}${eol}${eol}void main() { Imp }`);
    });
  }

  it("inserts immediately below an existing include, before its blank separator", () => {
    const { items, live } = complete('#include "other"\n\nvoid main() { Imp| }');
    const edits = items.find((item) => item.label === "Imported")?.additionalTextEdits || [];
    expect(edits[0].range.start).to.deep.equal({ line: 1, character: 0 });
    expect(TextDocument.applyEdits(live, edits)).to.equal('#include "other"\n#include "helper"\n\nvoid main() { Imp }');
  });

  it("resumes code completion after a raw string ending in a backslash", () => {
    const { items } = complete('void main() { string value = r"path\\"; Imp| }');
    expect(items.some((item) => item.label === "Imported")).to.equal(true);
  });

  it("supports struct type completions", () => {
    const { items } = complete("void main()\n{\n struct Imp|\n}");
    expect(items.find((item) => item.label === "ImportedStruct")?.additionalTextEdits).to.have.length(1);
    expect(items.some((item) => item.label === "Imported")).to.equal(false);
  });

  it("recognizes include syntax in both indexing and live completion", () => {
    const source = '# include "helper" /* tail */\n// #include "fake"\n/*\n#include "also_fake"\n*/\n#include "unfinished\n';
    expect(tokenizer.parseContent(source).getIndex().children).to.deep.equal(["helper"]);
    expect(tokenizer.tokenizeContent(source, "document").children).to.deep.equal(["helper"]);
  });

  it("can be disabled", () => {
    const { items } = complete("void main()\n{\n Imp|\n}", {}, false);
    expect(items.some((item) => item.additionalTextEdits)).to.equal(false);
  });

  it("filters imports by prefix and asks clients to refresh as the prefix changes", () => {
    const { items, response } = complete("void main()\n{\n imported_v|\n}\n");
    expect(response.isIncomplete).to.equal(true);
    expect(items.filter((item) => item.textEdit).map((item) => item.label)).to.deep.equal(["IMPORTED_VALUE"]);
  });

  it("bounds broad suggestion lists and finds later symbols as the prefix narrows", () => {
    const scripts = { choices: Array.from({ length: 300 }, (_, index) => `void ImportedChoice${index}();`).join("\n") + "\n" };
    const broad = complete("void main()\n{\n ImportedChoice|\n}\n", scripts);
    expect(broad.items.filter((item) => item.textEdit)).to.have.length(200);
    expect(broad.response.isIncomplete).to.equal(true);
    const narrow = complete("void main()\n{\n ImportedChoice299|\n}\n", scripts);
    expect(narrow.items.filter((item) => item.textEdit).map((item) => item.label)).to.deep.equal(["ImportedChoice299"]);
  });

  it("invalidates cached children when dependencies are added or updated", () => {
    const fixture = complete("void main()\n{\n Imp|\n}\n", { helper: '#include "later"\nvoid Imported(int value);\n' });
    const imports = () => fixture.request().items.filter((item: CompletionItem) => item.label === "Imported");
    expect(imports()).to.have.length(1);
    fixture.collection.createDocument(workspaceUri("later.nss"), tokenizer.tokenizeContent("void main() {}\n", "document"));
    expect(imports()).to.have.length(0);
    fixture.collection.updateDocument(TextDocument.create(workspaceUri("later.nss"), "nwscript", 2, "// Entry point removed\n"), tokenizer, { getFilePath: () => null });
    expect(imports()).to.have.length(1);
    fixture.collection.updateDocument(TextDocument.create(workspaceUri("later.nss"), "nwscript", 3, '#include "current"\n'), tokenizer, { getFilePath: () => null });
    expect(imports()).to.have.length(0);
  });

  it("reuses the existing child traversal on repeated completion requests", () => {
    const fixture = complete("void main()\n{\n Imp|\n}\n", { helper: '#include "dependency"\nvoid Imported(int value);\n', dependency: "void Dependency();\n" });
    const candidate = fixture.collection.get("helper");
    const getChildren = candidate.getChildren.bind(candidate);
    let traversals = 0;
    candidate.getChildren = () => {
      traversals++;
      return getChildren();
    };
    fixture.request();
    fixture.request();
    expect(traversals).to.equal(0);
  });
});
