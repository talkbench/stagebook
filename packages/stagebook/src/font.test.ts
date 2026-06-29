import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(join(here, "styles.css"), "utf8");
// Strip block comments so the documented rationale (which mentions the old
// CDN url and the relative path in prose) can't satisfy or trip the asserts.
const cssNoComments = stylesCss.replace(/\/\*[\s\S]*?\*\//g, "");

// Issue #412: Inter is bundled inside the package instead of fetched from the
// rsms.me CDN, so every participant gets the same font regardless of network /
// CSP / CDN availability. These guards pin that guarantee so a regression to a
// remote font url, or a broken publish contract that drops the woff2 from the
// tarball, fails CI instead of silently shipping a fallback font mid-study.
describe("styles.css bundles Inter locally, not from a CDN (#412)", () => {
  it("declares an @font-face for Inter", () => {
    expect(cssNoComments).toMatch(/@font-face[\s\S]*?font-family:\s*"Inter"/);
  });

  it("fetches no font over the network (no http(s) url in @font-face src)", () => {
    expect(cssNoComments).not.toMatch(/src:[^;]*url\(\s*["']?https?:\/\//i);
  });

  it("points the @font-face at the package-relative bundled woff2", () => {
    expect(cssNoComments).toMatch(
      /url\(\s*["']?\.\/assets\/InterVariable\.woff2["']?\s*\)/,
    );
  });
});

describe("package ships the bundled font (#412)", () => {
  const pkg = JSON.parse(
    readFileSync(join(here, "..", "package.json"), "utf8"),
  ) as { exports: Record<string, unknown>; files: string[] };

  it("exposes the woff2 on a stable subpath export", () => {
    expect(pkg.exports["./assets/InterVariable.woff2"]).toBe(
      "./src/assets/InterVariable.woff2",
    );
  });

  it("includes the font and its license in the published files", () => {
    expect(pkg.files).toContain("src/assets/InterVariable.woff2");
    expect(pkg.files).toContain("src/assets/Inter-OFL.txt");
  });

  it("the bundled woff2 and OFL license exist on disk", () => {
    expect(existsSync(join(here, "assets", "InterVariable.woff2"))).toBe(true);
    expect(existsSync(join(here, "assets", "Inter-OFL.txt"))).toBe(true);
  });

  it("the bundled woff2 matches the recorded upstream SHA-256 (provenance)", () => {
    // Pins the vendored binary to rsms/inter v4.1 web/InterVariable.woff2.
    // See src/assets/PROVENANCE.md. A re-vendor of a different build must
    // update both the hash here and the provenance record.
    const bytes = readFileSync(join(here, "assets", "InterVariable.woff2"));
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(sha).toBe(
      "693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3",
    );
  });

  it('the OFL license declares no Reserved Font Name (so font-family "Inter" is compliant)', () => {
    const ofl = readFileSync(join(here, "assets", "Inter-OFL.txt"), "utf8");
    expect(ofl).not.toMatch(/with Reserved Font Name/i);
  });
});
