import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Drift guard (#535). `#3b82f6` is the retired blue-500 that used to be
// `--stagebook-primary`. The standalone viewer app is a third chrome surface
// (alongside the reusable harness in packages/stagebook and the VS Code
// webview) that hardcoded the retired blue-500 in inline styles and kept it
// through the #535 bump to blue-600. App chrome must reference
// `var(--stagebook-primary, #2563eb)` (the app imports stagebook/styles, so the
// token is defined; the fallback is blue-600 too), never the retired literal.
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

describe("viewer app chrome color drift guard (#535)", () => {
  it("uses the accent token, not the retired blue-500 (#3b82f6)", () => {
    const offenders = walk(srcDir).filter((p) =>
      /#3b82f6\b/i.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
