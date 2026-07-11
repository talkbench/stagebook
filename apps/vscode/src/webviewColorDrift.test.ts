import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Drift guard (#535). `#3b82f6` is the retired blue-500 that used to be
// `--stagebook-primary`. Since #560 the webview injects the library's real
// styles.css for tokens + component styling, so this guard covers only the
// webview's own inline chrome styles: they must reference
// `var(--stagebook-primary, #2563eb)` (or a deliberate non-accent color), never
// the retired literal. (Before #560 the extension also hand-copied the token
// block, and pinning it to blue-500 there is what drove the original preview
// drift — see webviewUsesLibraryStyles.test.ts for the invariant that killed
// the copy.)
const srcDir = dirname(fileURLToPath(import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (entry.name.includes(".test.") || entry.name.includes(".ct.")) return [];
    return [p];
  });
}

describe("VS Code webview color drift guard (#535)", () => {
  it("uses the accent token, not the retired blue-500 (#3b82f6)", () => {
    const offenders = walk(srcDir).filter((p) =>
      /#3b82f6\b/i.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
