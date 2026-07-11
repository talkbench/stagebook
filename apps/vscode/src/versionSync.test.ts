import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The extension version mirrors the bundled stagebook version so the installed
// extension reports which stagebook it previews against (#562). It's derived at
// build time by scripts/sync-vscode-version.mjs (apps/vscode's `prepackage`
// hook), so every built vsix is correct regardless of the committed value — but
// this guards the committed values from drifting apart on a stagebook bump
// (asserting major.minor, which is the compatibility-meaningful part; the sync
// makes them exact).
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const version = (p: string): string =>
  JSON.parse(readFileSync(join(root, p), "utf8")).version as string;
const majorMinor = (v: string): string => v.split(".").slice(0, 2).join(".");

describe("extension version tracks stagebook (#562)", () => {
  it("mirrors the stagebook major.minor", () => {
    const lib = version("packages/stagebook/package.json");
    const ext = version("apps/vscode/package.json");
    expect(majorMinor(ext)).toBe(majorMinor(lib));
  });
});
