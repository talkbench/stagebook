import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The webview must render previewed components with the library's REAL
// styles.css, injected at runtime by the webview bundle — never a copy of the
// design tokens embedded in the extension HTML. A copy silently drifts from the
// library (it's what caused the retired-blue-500 preview bug, #559), and the
// preview is a development inspection surface that must mirror the library
// exactly (#560, superseding the value-sync guard #559 added). These assertions
// lock in the invariant: the extension embeds no --stagebook-* token
// definitions, and the webview entry imports + injects the stylesheet.

const here = dirname(fileURLToPath(import.meta.url));
const extensionSrc = readFileSync(join(here, "extension.ts"), "utf8");
const webviewEntry = readFileSync(join(here, "webview", "index.tsx"), "utf8");

describe("webview renders with the library's real styles.css (#560)", () => {
  it("the extension embeds no --stagebook-* token definitions (no hand-copied palette)", () => {
    // A definition is `--stagebook-x:`; a var() usage like
    // `var(--stagebook-text)` has no trailing colon and is fine.
    const tokenDefs = [...extensionSrc.matchAll(/--stagebook-[\w-]+\s*:/g)].map(
      (m) => m[0],
    );
    expect(tokenDefs).toEqual([]);
  });

  it("the webview entry imports and injects the library stylesheet", () => {
    expect(webviewEntry).toMatch(
      /import\s+\w+\s+from\s+["']stagebook\/styles["']/,
    );
    // Appended to <head> before mount so tokens are present when components
    // render.
    expect(webviewEntry).toMatch(/document\.head\.appendChild/);
  });
});
