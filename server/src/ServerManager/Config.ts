/* eslint-disable @typescript-eslint/naming-convention */
const defaultServerConfiguration = {
  autoCompleteFunctionsWithParams: false,
  includeCommentsInFunctionsHover: false,
  formatter: {
    enabled: false,
    executable: "clang-format",
    ignoredGlobs: [],
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
};
/* eslint-enable @typescript-eslint/naming-convention */

export type ServerConfiguration = typeof defaultServerConfiguration;
export { defaultServerConfiguration };
