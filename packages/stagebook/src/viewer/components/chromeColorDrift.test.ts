import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Drift guard (#535). `#3b82f6` is the retired blue-500 that used to be
// `--stagebook-primary`. Viewer chrome hardcoded it in inline styles and
// silently kept it through the #535 bump to blue-600 (#2563eb), so the preview
// rendered a mix of old and new blue: participant components tracked the token,
// the chrome didn't. styles.test.ts already guards the stylesheet, but the
// chrome lives in inline `.tsx` styles it never scanned — this closes that gap.
// Chrome must reference `var(--stagebook-primary, #2563eb)` (or a deliberate
// non-accent color), never the retired literal.
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (entry.name.includes(".test.") || entry.name.includes(".ct.")) return [];
    return [p];
  });
}

describe("viewer chrome color drift guard (#535)", () => {
  const dir = dirname(fileURLToPath(import.meta.url));

  it("uses the accent token, not the retired blue-500 (#3b82f6)", () => {
    const offenders = walk(dir).filter((p) =>
      /#3b82f6\b/i.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
