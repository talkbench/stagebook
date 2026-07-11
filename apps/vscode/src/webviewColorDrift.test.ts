import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Drift guard (#535 / #494). The VS Code webview hand-maintains a copy of the
// stagebook design tokens (extension.ts `getWebviewContent`) plus a few inline
// chrome styles. Because the bundled styles.css is loaded as text (not
// auto-injected), that hand-copy is the webview's ONLY source of :root tokens —
// so a stale value overrides the whole preview. Pre-#535 it pinned
// `--stagebook-primary` to the retired blue-500 (#3b82f6), which is why every
// `var(--stagebook-primary)` rendered old-blue while the (absent) playhead
// correctly fell back to rose-700. Keep #3b82f6 out of the extension source;
// chrome must use `var(--stagebook-primary, #2563eb)`.
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
