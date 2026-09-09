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

  it("the webview entry imports and injects the library stylesheet before mount", () => {
    expect(webviewEntry).toMatch(
      /import\s+\w+\s+from\s+["']stagebook\/styles["']/,
    );
    // Injected into <head> BEFORE createRoot so tokens are present when
    // components render (avoids a flash of unstyled/untokenized content).
    const injectAt = webviewEntry.indexOf("document.head.appendChild");
    const mountAt = webviewEntry.indexOf("createRoot(root)");
    expect(injectAt).toBeGreaterThan(-1);
    expect(mountAt).toBeGreaterThan(-1);
    expect(injectAt).toBeLessThan(mountAt);
  });
});

// The webview host injects its own `a/input/select/textarea:focus` outline
// (see vs/workbench/contrib/webview/browser/pre/index.html). It's a plain
// `:focus`, so it paints on mouse click — where Stagebook's `:focus-visible`
// rules intentionally don't — making the preview show a focus treatment the
// runner never renders. The chrome CSS suppresses it, but only for the
// mouse-focus case: a blanket `outline: none` is the exact pattern #610
// removed from the library, and reintroducing it here would strip the
// indicator that forced-colors repaints.
describe("preview suppresses only the host's mouse-focus outline (#610)", () => {
  it("scopes the suppression to :focus:not(:focus-visible)", () => {
    expect(extensionSrc).toMatch(
      /#root :focus:not\(:focus-visible\)\s*\{\s*outline: none;/,
    );
  });

  it("never suppresses a plain :focus or :focus-visible outline", () => {
    // Strip comments first — the rationale above the rule quotes the host's
    // declaration verbatim, including the text this would otherwise match.
    const css = extensionSrc.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{};]*:focus[^{};]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) {
      if (!/outline:\s*none/.test(body)) continue;
      expect(
        selector,
        `"${selector.trim()}" kills an outline without excluding :focus-visible`,
      ).toContain(":not(:focus-visible)");
    }
  });
});
