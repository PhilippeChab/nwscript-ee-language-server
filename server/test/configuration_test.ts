import { describe, it } from "mocha";
import { expect } from "chai";
import { defaultServerConfiguration, mergeConfiguration } from "../src/ServerManager/Config";

describe("Standalone configuration", () => {
  it("uses defaults when the client omits configuration or returns null", () => {
    for (const settings of [undefined, null, [], "invalid", { "nwscript-ee-lsp": null }]) {
      expect(mergeConfiguration(defaultServerConfiguration, settings)).to.deep.equal(defaultServerConfiguration);
    }
  });

  it("merges wrapped updates without losing initialization options or formatter style keys", () => {
    const initial = mergeConfiguration(defaultServerConfiguration, {
      compiler: { nwnHome: "/game/home" },
      formatter: { style: { ColumnLimit: 80, SortIncludes: false } },
    });
    const updated = mergeConfiguration(initial, {
      "nwscript-ee-lsp": { compiler: { enabled: false }, formatter: { enabled: true, style: { IndentWidth: 2 } } },
    });
    expect(updated.compiler.nwnHome).to.equal("/game/home");
    expect(updated.compiler.enabled).to.equal(false);
    expect(updated.formatter.enabled).to.equal(true);
    expect(updated.formatter.style).to.include({ ColumnLimit: 80, SortIncludes: false, IndentWidth: 2 });
    expect(initial.formatter.enabled).to.equal(false);
    expect(defaultServerConfiguration.formatter.style.ColumnLimit).to.equal(250);
  });

  it("resets omitted snapshot values while retaining initialization defaults and partial updates", () => {
    const baseline = mergeConfiguration(defaultServerConfiguration, { compiler: { enabled: false }, formatter: { style: { ColumnLimit: 90 } } });
    const configured = mergeConfiguration(baseline, { formatter: { style: { ColumnLimit: 80, SpaceBeforeParens: "Always" } } }, baseline);
    const partial = mergeConfiguration(configured, { hovering: { addCommentsToFunctions: true } });
    expect(partial.formatter.style).to.include({ ColumnLimit: 80, SpaceBeforeParens: "Always" });
    const replaced = mergeConfiguration(partial, { formatter: { style: {} } }, baseline);
    expect(replaced.formatter.style).not.to.have.property("SpaceBeforeParens");
    expect(replaced.formatter.style.ColumnLimit).to.equal(90);
    expect(replaced.compiler.enabled).to.equal(false);
    expect(replaced.hovering.addCommentsToFunctions).to.equal(false);
    expect(mergeConfiguration(configured, {}, baseline)).to.deep.equal(baseline);
    for (const invalid of [null, undefined, [], { "nwscript-ee-lsp": null }]) {
      expect(mergeConfiguration(configured, invalid, baseline)).to.deep.equal(configured);
    }
  });

  it("can reset an explicit compiler OS to automatic detection", () => {
    const initial = mergeConfiguration(defaultServerConfiguration, { compiler: { os: "Linux" } });
    expect(initial.compiler.os).to.equal("Linux");
    expect(mergeConfiguration(initial, { compiler: { os: null } }).compiler.os).to.equal(null);
  });

  it("retains valid settings when a client sends malformed section values", () => {
    const config = mergeConfiguration(defaultServerConfiguration, {
      compiler: { enabled: "false", nwnHome: null, os: "unsupported" },
      formatter: { ignoredGlobs: [5, null], executable: false },
      completion: null,
    });
    expect(config).to.deep.equal(defaultServerConfiguration);
  });
});
