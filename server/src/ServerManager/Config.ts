/* eslint-disable @typescript-eslint/naming-convention */
const defaultServerConfiguration = {
  completion: {
    addParamsToFunctions: false,
  },
  hovering: {
    addCommentsToFunctions: false,
  },
  formatter: {
    enabled: false,
    verbose: false,
    executable: "clang-format",
    ignoredGlobs: [] as string[],
    style: {
      BasedOnStyle: "Google",
      AlignTrailingComments: true,
      AlignConsecutiveAssignments: true,
      ColumnLimit: 250,
      BreakBeforeBraces: "Allman",
      AlignEscapedNewlinesLeft: true,
      AlwaysBreakBeforeMultilineStrings: true,
      MaxEmptyLinesToKeep: 1,
      TabWidth: 4,
      IndentWidth: 4,
      UseTab: "Always",
    },
  },
  compiler: {
    enabled: true,
    os: null as "Linux" | "Darwin" | "Windows_NT" | null,
    verbose: false,
    reportWarnings: false,
    nwnHome: "",
    nwnInstallation: "",
  },
};
/* eslint-enable @typescript-eslint/naming-convention */

export type ServerConfiguration = typeof defaultServerConfiguration;
export { defaultServerConfiguration };

// Accept the same settings section from initializationOptions, configuration
// responses, and pushed didChangeConfiguration notifications.
export function mergeConfiguration(current: ServerConfiguration, settings: unknown): ServerConfiguration {
  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  const section = isObject(settings) && "nwscript-ee-lsp" in settings ? settings["nwscript-ee-lsp"] : settings;
  const input = isObject(section) ? section : {};
  const merge = (defaults: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => {
        const next = values[key];
        if (isObject(value)) return [key, merge(value, isObject(next) ? next : {})];
        const valid =
          next !== undefined &&
          (value === null ? next === null || typeof next === "string" : Array.isArray(value) ? Array.isArray(next) && next.every((item) => typeof item === "string") : typeof next === typeof value);
        return [key, valid ? next : Array.isArray(value) ? [...value] : value];
      }),
    );
  const result = merge(current, input) as ServerConfiguration;
  // clang-format supports arbitrary style keys beyond the bundled defaults.
  const formatter = isObject(input.formatter) ? input.formatter : {};
  if (isObject(formatter.style)) result.formatter.style = { ...result.formatter.style, ...formatter.style };
  // This setting stays nullable even after an explicit OS has been selected.
  const compiler = isObject(input.compiler) ? input.compiler : {};
  if (compiler.os === null) result.compiler.os = null;
  if (result.compiler.os !== null && !["Linux", "Darwin", "Windows_NT"].includes(result.compiler.os)) result.compiler.os = current.compiler.os;
  return result;
}
