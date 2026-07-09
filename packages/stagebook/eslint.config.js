import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "*.config.ts", "*.config.js", "**/*.ct.tsx", "playwright/"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Validators lifted from the VS Code extension carry over their previous
    // quality bar (apps/vscode has no linter). Unlike the viewer lift — whose
    // unsafe-* hits traced to the schema typing treatments/introSequences as
    // `any` and were cleared in #504 by tightening those schema types — these
    // hits come from a different source: traversal of the `yaml` library's
    // loosely-typed AST (yamlPositionMap.ts) and async functions kept `async`
    // for interface parity. Tightening them (typing the yaml AST, auditing the
    // require-await sites) is tracked for a separate follow-up.
    files: ["**/src/validate/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
);
