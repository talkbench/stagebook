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
  // `mdast-util-from-markdown` (used by `getMarkdownImageReferences`) is
  // ESM-only. Externalized, the generated `dist/index.cjs` `require()`s it and
  // throws for CJS consumers (no `require` export / broken named-export
  // interop). Bundling it — and its transitive micromark/mdast tree, which
  // isn't a direct dependency so is inlined anyway — keeps the CJS build
  // self-contained. Unlike `unified`/`remark-parse`, it pulls in NO Node
  // built-ins (no `vfile`), so bundling it is safe for the browser-facing
  // viewer/webview builds too. See #576 / #577.
  noExternal: ["mdast-util-from-markdown"],
});
