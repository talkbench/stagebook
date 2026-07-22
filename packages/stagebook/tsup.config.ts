import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "components/index": "src/components/index.ts",
    "viewer/index": "src/viewer/index.ts",
    "validate/index": "src/validate/index.ts",
    "dispatch/index": "src/dispatch/index.ts",
    "dispatch/contract": "src/dispatch/contract.ts",
    "cli/validate": "src/cli/validate.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: true,
  clean: true,
  sourcemap: true,
  // `unified` / `remark-parse` (used by `getMarkdownImageReferences` in the
  // root entry) are ESM-only. Externalized, the generated `dist/index.cjs`
  // `require()`s them and throws for CJS consumers (no `require` export /
  // broken named-export interop). Bundling them — and their transitive
  // micromark/mdast tree, which isn't a direct dependency so is inlined
  // anyway — keeps the CJS build self-contained. See #576.
  noExternal: ["unified", "remark-parse"],
});
