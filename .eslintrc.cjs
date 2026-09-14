module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    extraFileExtensions: [".cjs"],
    ecmaVersion: "latest",
    sourceType: "module",
    project: ["./client/tsconfig.json", "./server/tsconfig.json", "./server/tsconfig.eslint.json"],
  },
  plugins: ["@typescript-eslint"],
  extends: ["standard-with-typescript", "plugin:prettier/recommended"],
  overrides: [
    {
      files: [".eslintrc.cjs"],
      rules: {
        // ESLint rule IDs contain slashes and hyphens and cannot be renamed.
        "@typescript-eslint/naming-convention": ["warn", { selector: "default", format: ["camelCase"] }, { selector: "objectLiteralProperty", modifiers: ["requiresQuotes"], format: null }],
      },
    },
  ],
  rules: {
    "@typescript-eslint/quotes": ["error", "double", { avoidEscape: true }],
    "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    "@typescript-eslint/naming-convention": "warn",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/no-floating-promises": "warn",
    "@typescript-eslint/semi": "off",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/space-before-function-paren": "off",
    "@typescript-eslint/array-type": "off",
    "@typescript-eslint/strict-boolean-expressions": "off",
    "@typescript-eslint/prefer-nullish-coalescing": "off",
    "@typescript-eslint/consistent-type-assertions": "off",
    "@typescript-eslint/no-extraneous-class": "off",
    curly: "warn",
    eqeqeq: "warn",
    "no-unsafe-finally": "warn",
    "no-throw-literal": "warn",
    "prefer-const": "warn",
    "space-before-function-paren": "off",
    semi: "off",
    quotes: "off",
    "no-extra-boolean-cast": "off",
    "prettier/prettier": [
      "error",
      {
        endOfLine: "auto",
      },
    ],
  },
  ignorePatterns: ["out", "**/*.d.ts"],
};
