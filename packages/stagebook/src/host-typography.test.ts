import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "host-typography.css");

/*
 * Source-shape contracts only. Anything about how these rules RENDER — the
 * heading scale matching markdown, the cascade between the grouped rule and
 * the h1 rule — is asserted in a real browser by host-typography.ct.tsx,
 * because no amount of source-matching can see the cascade (#607).
 */
describe("host-typography.css", () => {
  const css = readFileSync(cssPath, "utf8");
  // Strip comments so documented override examples or JSDoc-style prose
  // can't accidentally satisfy the assertions below.
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("declares the typography-scale custom properties", () => {
    for (const name of [
      "--stagebook-h1-size",
      "--stagebook-h2-size",
      "--stagebook-h3-size",
      "--stagebook-h4-size",
      "--stagebook-h5-size",
      "--stagebook-h6-size",
      "--stagebook-body-size",
      "--stagebook-body-line-height",
      "--stagebook-heading-weight",
      "--stagebook-h1-weight",
      "--stagebook-heading-line-height",
      "--stagebook-link-hover",
    ]) {
      expect(cssWithoutComments).toMatch(new RegExp(`${name}\\s*:`));
    }
  });

  it("applies the box-sizing reset to universal selectors", () => {
    // Pins the exact shape the issue prescribed — don't silently degrade to
    // a class-scoped reset which would break the contract.
    expect(cssWithoutComments).toMatch(
      /\*\s*,\s*::before\s*,\s*::after\s*{[^}]*box-sizing:\s*border-box/,
    );
  });

  it("applies the media max-width rule to bare img/video tags", () => {
    expect(cssWithoutComments).toMatch(
      /\bimg\s*,\s*video\s*{[^}]*max-width:\s*100%/,
    );
  });

  it("sets heading font-sizes from variables", () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(cssWithoutComments).toMatch(
        new RegExp(
          `\\bh${n}\\s*{[^}]*font-size:\\s*var\\(--stagebook-h${n}-size`,
        ),
      );
    }
  });

  it("styles bare <a> with stagebook-link and hover variants", () => {
    expect(cssWithoutComments).toMatch(
      /\ba\s*{[^}]*color:\s*var\(--stagebook-link[^)]*\)/,
    );
    expect(cssWithoutComments).toMatch(
      /\ba:hover\s*{[^}]*color:\s*var\(--stagebook-link-hover/,
    );
  });

  it("has no class selectors (the 'no .stagebook-* rules' contract)", () => {
    // The file must target bare tags only. Class selectors would put
    // styling on stagebook's own components and defeat the "host-only"
    // contract documented in the header.
    const ruleSelectors = [
      ...cssWithoutComments.matchAll(/([^{}]+){/g),
    ].flatMap((m) =>
      m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    // Real class selectors only: a literal `.` followed by an identifier.
    // Raw `includes(".")` would false-positive on attribute selectors like
    // `[href*=".pdf"]` if any were ever added.
    const classSelectorPattern = /\.[A-Za-z_-][\w-]*/;
    const classSelectors = ruleSelectors.filter((s) =>
      classSelectorPattern.test(s),
    );
    expect(classSelectors).toEqual([]);
  });
});
