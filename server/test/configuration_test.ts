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
