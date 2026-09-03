import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "host-typography.css");

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

/*
 * Stagebook renders headings on two surfaces: researcher markdown, styled
 * inline by `Markdown`/`Prompt`, and the host's own bare tags, styled by this
 * stylesheet. A host that writes `<h2>` beside a rendered `## ` expects one
 * heading, not two that merely resemble each other, so the scales are pinned
 * against each other here rather than trusted to stay in sync by hand — the
 * two families of custom properties (`--stagebook-h2-size` and
 * `--stagebook-prompt-h2-size`) are independent, and before this test they
 * agreed on size only by coincidence. See issue #607.
 */
describe("host-typography.css agrees with the Markdown heading scale", () => {
  const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const markdown = readFileSync(
    join(here, "components", "form", "Markdown.tsx"),
    "utf8",
  );

  /** The literal fallback baked into a `var(--name, literal)` in Markdown.tsx. */
  function promptFallback(name: string): string {
    const match = markdown.match(new RegExp(`var\\(${name},\\s*([^)]+)\\)`));
    if (match === null) {
      throw new Error(`Markdown.tsx no longer reads ${name}`);
    }
    return match[1].trim();
  }

  /** A custom property's value as declared in this stylesheet, or null. */
  function hostToken(name: string): string | null {
    const match = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    return match === null ? null : match[1].trim();
  }

  it.each([1, 2, 3, 4, 5, 6])("sizes h%i the same as markdown does", (n) => {
    expect(hostToken(`--stagebook-h${n}-size`)).toBe(
      promptFallback(`--stagebook-prompt-h${n}-size`),
    );
  });

  it.each([1, 2, 3, 4, 5, 6])("weights h%i the same as markdown does", (n) => {
    // The per-level token when the level overrides the shared default,
    // otherwise the shared one — the same resolution order the cascade uses.
    const effective =
      hostToken(`--stagebook-h${n}-weight`) ??
      hostToken("--stagebook-heading-weight");
    expect(effective).toBe(promptFallback(`--stagebook-prompt-h${n}-weight`));
  });

  it("gives bare headings the markdown heading line-height", () => {
    const base = markdown.match(/const headingBase[^{]*{([^}]*)}/);
    if (base === null) {
      throw new Error("Markdown.tsx no longer defines a headingBase style");
    }
    const lineHeight = base[1].match(/lineHeight:\s*([\d.]+)/);
    if (lineHeight === null) {
      throw new Error("headingBase no longer sets a numeric lineHeight");
    }
    expect(hostToken("--stagebook-heading-line-height")).toBe(lineHeight[1]);
  });

  it("consumes the weight and line-height tokens in the heading rules", () => {
    // Declaring a custom property proves nothing on its own — the grouped
    // h1..h6 rule has to read it, or the value is inert.
    const groupRule = css.match(
      /\bh1\s*,\s*h2\s*,\s*h3\s*,\s*h4\s*,\s*h5\s*,\s*h6\s*{([^}]*)}/,
    );
    if (groupRule === null) {
      throw new Error("no grouped h1..h6 rule found");
    }
    expect(groupRule[1]).toMatch(
      /font-weight:\s*var\(--stagebook-heading-weight/,
    );
    expect(groupRule[1]).toMatch(
      /line-height:\s*var\(--stagebook-heading-line-height/,
    );
    // h1 is the one level whose weight differs from the shared default, so it
    // needs its own declaration after the group rule to win the cascade.
    expect(css).toMatch(
      /\bh1\s*{[^}]*font-weight:\s*var\(--stagebook-h1-weight/,
    );
  });

  it("keeps margin-block: 0 on headings, unlike markdown", () => {
    // Deliberate divergence, not an oversight: this layer zeroes heading
    // margins so host layouts own vertical rhythm (hosts stack cards with
    // `space-y-*` and similar). Adopting markdown's 0.75em/0.5em here would
    // silently add space above every host heading. Pinned so a future
    // "make them match" pass doesn't quietly take the spacing too.
    const groupRule = css.match(
      /\bh1\s*,\s*h2\s*,\s*h3\s*,\s*h4\s*,\s*h5\s*,\s*h6\s*{([^}]*)}/,
    );
    if (groupRule === null) {
      throw new Error("no grouped h1..h6 rule found");
    }
    expect(groupRule[1]).toMatch(/margin-block:\s*0\s*;/);
  });
});
