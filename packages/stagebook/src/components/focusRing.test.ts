import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FOCUS_RING_HALO, focusRingCss, focusOutlineCss } from "./focusRing.js";

const here = dirname(fileURLToPath(import.meta.url));

// #610. These are the cheap-tier guards on the shared focus treatment. The
// Playwright gate (focus.gate.ct.tsx) proves the rendered result in three
// engines; these catch the same regressions in milliseconds, and catch one
// thing the gate structurally cannot — a seventeenth hand-rolled copy.
describe("focusRingCss (#610)", () => {
  it("puts the page-colored spacer inside the accent ring", () => {
    // Order is the whole point. Reversed — accent inside, page color outside
    // — the ring abuts the control's own border again, which is the 1.03:1
    // geometry #610 exists to fix, and it would still 'contain' both colors.
    const spacer = FOCUS_RING_HALO.indexOf("--stagebook-bg");
    const accent = FOCUS_RING_HALO.indexOf("--stagebook-focus-ring");
    expect(spacer).toBeGreaterThanOrEqual(0);
    expect(accent).toBeGreaterThan(spacer);
    // ...and the accent ring is the wider of the two, or it's hidden behind
    // the spacer entirely.
    expect(FOCUS_RING_HALO).toMatch(/0 0 0 2px[\s\S]*?0 0 0 4px/);
  });

  it("reaches through to --stagebook-primary when styles.css isn't loaded", () => {
    // styles.css is optional (#213) and is the only place that aliases
    // --stagebook-focus-ring to the accent. A host that skips it and themes
    // by setting --stagebook-primary alone leaves the ring token undefined;
    // with a single-level fallback the ring would ignore their accent and
    // paint our hard-coded blue. Both indicators have to nest.
    for (const css of [FOCUS_RING_HALO, focusOutlineCss()]) {
      expect(css).toContain(
        "var(--stagebook-focus-ring, var(--stagebook-primary, #2563eb))",
      );
    }
  });

  it("keeps a transparent outline so forced-colors has something to repaint", () => {
    // The load-bearing half of the forced-colors fix: that mode drops
    // box-shadow and honors outline. `outline: none` here would silently
    // remove the indicator for high-contrast users.
    const css = focusRingCss();
    expect(css).toMatch(/outline:\s*2px solid transparent/);
    expect(css).not.toMatch(/outline:\s*none/);
  });

  it("appends caller shadows after the halo, not before it", () => {
    // Button, TextArea, ListSorter and Slider all pass their resting
    // elevation this way. Ahead of the halo it would paint over the ring;
    // omitted entirely, the control would flatten while focused.
    const css = focusRingCss("0 1px 2px 0 rgba(0, 0, 0, 0.05)");
    expect(css).toContain(FOCUS_RING_HALO);
    expect(css.indexOf("0 1px 2px 0 rgba(0, 0, 0, 0.05)")).toBeGreaterThan(
      css.indexOf(FOCUS_RING_HALO),
    );
  });

  it("emits one declaration per property, each terminated", () => {
    // The result is interpolated into a rule body; a dropped semicolon would
    // silently swallow the following declaration.
    for (const css of [focusRingCss(), focusRingCss("0 0 0 1px red")]) {
      expect(css.trimEnd().endsWith(";")).toBe(true);
      expect(css.match(/box-shadow:/g)).toHaveLength(1);
    }
  });

  it("draws inline text with a real outline, from the same token", () => {
    // Markdown links/code blocks: a halo would ring each wrapped line
    // fragment. forced-colors already honors outline, so no transparent
    // placeholder is needed here.
    expect(focusOutlineCss()).toMatch(
      /outline:\s*2px solid var\(--stagebook-focus-ring/,
    );
  });
});

// The structural half of the fix. The gate covers the sites that exist
// today; this is what stops a seventeenth copy of the broken pattern from
// being written next to them.
describe("no component hand-rolls a focus ring (#610)", () => {
  /** Drop block comments — JSDoc and the CSS comments inside <style>. */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "");
  }

  function collect(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) collect(p, out);
      else if (/\.tsx?$/.test(entry) && !/\.(test|ct)\.tsx?$/.test(entry))
        out.push(p);
    }
    return out;
  }

  // Both remaining `outline: none` declarations are deliberate and are
  // explained at their sites (and in docs/decisions/2026-09-focus-indicator.md):
  // neither element is one a keyboard user navigates by.
  const ALLOWED = [
    // Zero-size invisible range input; the indicator is drawn on the thumb.
    join(here, "form", "Slider.tsx"),
    // tabIndex={-1} hotkey-scoping container in the viewer chrome, focused
    // programmatically and never a tab stop.
    join(here, "..", "viewer", "components", "Viewer.tsx"),
  ];

  it("pairs no `outline: none` with a box-shadow focus ring", () => {
    const offenders: string[] = [];
    for (const file of collect(here)) {
      if (ALLOWED.includes(file)) continue;
      // Comments stripped first: several of these files (this helper's own
      // doc block included) discuss `outline: none` as the thing not to do.
      const src = stripComments(readFileSync(file, "utf8"));
      if (/outline:\s*(none|"none")/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("routes every focus ring through the shared helper", () => {
    // A `:focus`/`:focus-visible` rule that paints a box-shadow must get it
    // from focusRingCss(), or it has re-derived the ring by hand and can
    // drift from the treatment the gate asserts.
    const offenders: string[] = [];
    for (const file of collect(here)) {
      const src = stripComments(readFileSync(file, "utf8"));
      // Rule bodies for a :focus / :focus-visible / :focus-within selector.
      for (const m of src.matchAll(
        /:focus(?:-visible|-within)?\s*\{([^}]*)\}/g,
      )) {
        const body = m[1];
        if (!/box-shadow/.test(body)) continue;
        if (!/focusRingCss\(/.test(body))
          offenders.push(`${file}: ${body.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
