import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The VS Code webview hand-copies the stagebook :root design tokens into the
// preview (extension.ts `getWebviewContent`) because the bundled styles.css is
// loaded as text, not auto-injected — so that copy is the webview's ONLY source
// of :root tokens. A stale value there silently overrides the whole preview:
// pre-#535 the copy pinned --stagebook-primary to the retired blue-500 while the
// real palette had already moved to blue-600, so every var(--stagebook-primary)
// rendered old-blue. The single-literal drift guard (webviewColorDrift.test.ts)
// only catches that one retired hex; this test enforces the invariant the copy's
// own comment states — every COLOR token it copies must equal the value
// styles.css resolves it to — so a future drift that isn't #3b82f6 (a typo, or
// the next intentional bump) is caught too. Durable fix (inject the real
// styles.css and delete the copy) is tracked in #494.

const here = dirname(fileURLToPath(import.meta.url));
const extensionSrc = readFileSync(join(here, "extension.ts"), "utf8");
const stylesCss = readFileSync(
  join(here, "..", "..", "..", "packages", "stagebook", "src", "styles.css"),
  "utf8",
);

/** Parse the first `:root { … }` block into a name → raw-value map. */
function parseRoot(source: string): Map<string, string> {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Custom-property values use parens, never braces, so the first close-brace
  // ends the block.
  const body = /:root\s*\{([\s\S]*?)\}/.exec(noComments)?.[1] ?? "";
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].trim());
  }
  return vars;
}

const stylesVars = parseRoot(stylesCss);
const extVars = parseRoot(extensionSrc);

/**
 * Resolve a value through styles.css `var(--x)` / `var(--x, fallback)` aliases
 * to a solid 6-digit hex, or null for non-hex values (rgba / color-mix / size /
 * font) which this test deliberately doesn't compare.
 */
function resolveHex(value: string, seen = new Set<string>()): string | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v);
  if (varMatch) {
    const [, ref, fallback] = varMatch;
    if (stylesVars.has(ref) && !seen.has(ref)) {
      seen.add(ref);
      const resolved = resolveHex(stylesVars.get(ref) ?? "", seen);
      if (resolved) return resolved;
    }
    if (fallback) return resolveHex(fallback, seen);
  }
  return null;
}

describe("VS Code webview :root tokens stay in sync with styles.css (#535/#494)", () => {
  // Every --stagebook-* token the webview copies whose styles.css value resolves
  // to a solid hex (i.e. the color tokens — the drift risk that bit us).
  const colorTokens = [...extVars.keys()].filter(
    (name) =>
      name.startsWith("--stagebook-") &&
      resolveHex(stylesVars.get(name) ?? "") !== null,
  );

  it("actually checks the accent tokens (guards against a vacuous pass)", () => {
    for (const token of [
      "--stagebook-primary",
      "--stagebook-primary-hover",
      "--stagebook-primary-active",
    ]) {
      expect(colorTokens).toContain(token);
    }
  });

  it.each(colorTokens)("%s matches the resolved styles.css value", (token) => {
    const expected = resolveHex(stylesVars.get(token) ?? "");
    const actual = resolveHex(extVars.get(token) ?? "");
    expect(actual).toBe(expected);
  });
});
