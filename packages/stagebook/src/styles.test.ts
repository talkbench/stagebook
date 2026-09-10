import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const stylesPath = join(here, "styles.css");
const componentsDir = join(here, "components");

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) collectFiles(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

function extractDefined(css: string): Set<string> {
  // Strip block comments first so documented override examples like
  // `--stagebook-foo: ...` inside `/* ... */` aren't mistaken for real
  // declarations.
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // Matches `--stagebook-foo:` (only declarations on the left-hand side).
  const defined = new Set<string>();
  const re = /(--stagebook-[\w-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssWithoutComments)) !== null) defined.add(m[1]);
  return defined;
}

function extractReferenced(source: string): Set<string> {
  // Only match names in real reference contexts: var(--name), getComputedStyle
  // property lookups, or CSSProperties / inline-style object keys. This
  // avoids false positives from prose comments like `--stagebook-prompt-*`.
  const referenced = new Set<string>();
  const patterns = [
    /var\(\s*(--stagebook-[a-z0-9][a-z0-9-]*)/gi,
    /getPropertyValue\(\s*["'](--stagebook-[a-z0-9][a-z0-9-]*)["']/gi,
    /["'](--stagebook-[a-z0-9][a-z0-9-]*)["']\s*:/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) referenced.add(m[1]);
  }
  return referenced;
}

describe("styles.css custom property coverage", () => {
  it("defines every --stagebook-* property referenced by component sources", () => {
    const css = readFileSync(stylesPath, "utf8");
    const defined = extractDefined(css);

    const files = collectFiles(componentsDir);
    const offenders: { file: string; name: string }[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const name of extractReferenced(src)) {
        if (!defined.has(name)) {
          offenders.push({ file, name });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no component references a private --sb-* primitive (theme via --stagebook-* only)", () => {
    // Primitives are an internal implementation detail; components must only
    // reference the public --stagebook-* semantic tokens so host overrides on
    // those tokens are honored everywhere (#535).
    const leaks: string[] = [];
    for (const file of collectFiles(componentsDir)) {
      if (/var\(\s*--sb-/.test(readFileSync(file, "utf8"))) leaks.push(file);
    }
    expect(leaks).toEqual([]);
  });
});

// Issue #610: the focus ring went opaque, and the translucent value it used
// to carry moved to --stagebook-primary-tint. The two have to stay split:
// re-aliasing the tint to the accent turns the Slider's hover track solid
// blue, and re-introducing alpha on the ring restores the 1.03:1 defect —
// both silently in the stylesheet. The render gates catch the consequences
// (focus.gate.ct.tsx reads the ring, a11y.gate.ct.tsx the ticks on the
// hovered track); this names the cause.
describe("the focus ring is opaque and the tint is not (#610)", () => {
  const css = readFileSync(stylesPath, "utf8");
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  /** Every declared value for a token, including @supports overrides. */
  function valuesOf(name: string): string[] {
    return [
      ...noComments.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, "g")),
    ].map((m) => m[1].trim().replace(/\s+/g, " "));
  }

  it("--stagebook-focus-ring carries no alpha, in every branch", () => {
    const values = valuesOf("--stagebook-focus-ring");
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v, `${v} must be opaque`).not.toMatch(
        /rgba|transparent|color-mix/,
      );
    }
  });

  it("--stagebook-primary-tint stays translucent, in every branch", () => {
    // Two branches: the static rgba default and the color-mix upgrade. Both
    // ship, and both have to stay translucent.
    const values = valuesOf("--stagebook-primary-tint");
    expect(values.length).toBe(2);
    for (const v of values) {
      expect(v, `${v} must be translucent`).toMatch(/rgba|transparent/);
    }
  });

  it("the Slider hover track uses the tint, not the ring", () => {
    const slider = readFileSync(
      join(componentsDir, "form", "Slider.tsx"),
      "utf8",
    );
    expect(slider).toContain("var(--stagebook-primary-tint,");
    // The track's hover fill must not reach for the ring token again.
    // The track fill inside a hovered wrapper — not the wrapper's own
    // hover background, which is a different rule using a different token.
    const hoverRule =
      /-wrapper:hover \.\$\{trackClass\}\s*\{([^}]*)\}/.exec(slider)?.[1] ?? "";
    expect(hoverRule).toContain("background-color");
    expect(hoverRule).toContain("--stagebook-primary-tint");
    expect(hoverRule).not.toContain("--stagebook-focus-ring");
  });
});

// Issue #116: form resets, focus rings, and table styles previously
// hardcoded values instead of referencing the --stagebook-* tokens declared
// at :root. These tests pin the migration so hardcoded values can't sneak
// back in and drift from the themeable surface.
describe("styles.css uses theme variables for hardcoded values (#116)", () => {
  const css = readFileSync(stylesPath, "utf8");

  // Strip the :root declaration block so we only look at rule bodies —
  // otherwise the token declarations themselves would always match. Guard
  // every index: if :root is renamed or deleted, indexOf returns -1 and
  // the resulting slice would be silently wrong, causing bare-literal
  // assertions to pass when they shouldn't.
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rootSelectorIdx = cssWithoutComments.indexOf(":root");
  expect(rootSelectorIdx).toBeGreaterThanOrEqual(0);
  const rootOpenIdx = cssWithoutComments.indexOf("{", rootSelectorIdx);
  expect(rootOpenIdx).toBeGreaterThanOrEqual(0);
  const rootCloseIdx = cssWithoutComments.indexOf("}", rootOpenIdx);
  expect(rootCloseIdx).toBeGreaterThanOrEqual(0);
  const outsideRoot =
    cssWithoutComments.slice(0, rootOpenIdx) +
    cssWithoutComments.slice(rootCloseIdx + 1);

  it("declares a --stagebook-surface token for form control backgrounds", () => {
    expect(css).toMatch(/--stagebook-surface\s*:/);
  });

  it.each([
    ["var(--stagebook-border, #d1d5db)", "form border"],
    ["var(--stagebook-text, #1f2937)", "form text color"],
    ["var(--stagebook-surface, #fff)", "form control background"],
  ])("references %s (%s)", (needle) => {
    expect(css).toContain(needle);
  });

  // Table styles moved from styles.css to Markdown.tsx (issue #214). The
  // tokenization guarantee from #116 still holds — it's just asserted
  // against the component source now, since that's the source of truth.
  //
  // We assert two things per token:
  // 1. The token name appears in a real reference context (inside a `var(...)`
  //    call or a CSSProperties key), not just in a prose comment. We reuse
  //    extractReferenced() for that — same helper as the coverage test above.
  // 2. The full `var(--name, fallback)` string appears verbatim, which pins
  //    the fallback value too so it can't silently drift.
  // The two checks together guarantee the token is referenced AND the
  // documented fallback matches.
  const markdownSrc = readFileSync(
    join(componentsDir, "form", "Markdown.tsx"),
    "utf8",
  );
  const markdownReferenced = extractReferenced(markdownSrc);

  it.each([
    [
      "--stagebook-border",
      "var(--stagebook-border, #d1d5db)",
      "table cell border",
    ],
    [
      "--stagebook-prompt-max-width",
      "var(--stagebook-prompt-max-width, 36rem)",
      "table max-width",
    ],
    [
      "--stagebook-bg-muted",
      "var(--stagebook-bg-muted, #f9fafb)",
      "table header background",
    ],
    [
      "--stagebook-table-text",
      "var(--stagebook-table-text, #374151)",
      "table cell text color",
    ],
    [
      "--stagebook-table-header-text",
      "var(--stagebook-table-header-text, #1f2937)",
      "table header text color",
    ],
  ])("Markdown.tsx references %s via %s (%s)", (name, needle) => {
    // Real reference (not just a comment mention).
    expect(markdownReferenced.has(name)).toBe(true);
    // Verbatim var() call with the documented fallback.
    expect(markdownSrc).toContain(needle);
  });

  it("derives focus ring border-color from --stagebook-primary", () => {
    // focus blocks appear after :root — they must reference the primary token
    // rather than the literal #3b82f6.
    expect(outsideRoot).toMatch(
      /border-color:\s*var\(--stagebook-primary[^)]*\)/,
    );
  });

  it("derives focus ring box-shadow from --stagebook-primary", () => {
    // Either direct reference to --stagebook-primary, or to the derived
    // --stagebook-focus-ring token, which must itself resolve to the accent
    // — as a plain alias (what #610 made it, now that the ring is opaque)
    // or as a color-mix of it (what it was while the ring was translucent).
    const focusRingDerivesFromPrimary =
      /--stagebook-focus-ring\s*:\s*(?:var\(--stagebook-primary\)|color-mix\([^)]*var\(--stagebook-primary)/;
    expect(css).toMatch(focusRingDerivesFromPrimary);
    expect(outsideRoot).toMatch(
      /box-shadow:[^;]*var\(--stagebook-(?:primary|focus-ring)/,
    );
  });

  it("radio/checkbox checked fill uses --stagebook-primary (inline, per #213)", () => {
    // Checkbox + radio styles moved from styles.css to inline per #213.
    // The #116 guarantee (checked fill sources from --stagebook-primary,
    // not a bare literal) now needs to be checked on the inline-styled
    // components themselves.
    const radioSrc = readFileSync(
      join(here, "components/form/RadioGroup.tsx"),
      "utf8",
    );
    const checkboxSrc = readFileSync(
      join(here, "components/form/CheckboxGroup.tsx"),
      "utf8",
    );
    const markdownSrc = readFileSync(
      join(here, "components/form/Markdown.tsx"),
      "utf8",
    );
    for (const src of [radioSrc, checkboxSrc, markdownSrc]) {
      expect(src).toMatch(/backgroundColor:\s*["']var\(--stagebook-primary/);
      expect(src).toMatch(/borderColor:\s*["']var\(--stagebook-primary/);
    }
  });

  // The literal-value checks strip `var(--token, fallback)` calls first: the
  // fallback is the *documented* fallback and only resolves when the variable
  // is missing, so hosts that override --stagebook-primary get their value.
  // What we want to catch is bare literal uses that bypass the variable
  // entirely.
  //
  // A naive /var\([^)]*\)/ regex would mis-handle nested parens in
  // fallbacks like `var(--x, rgba(0,0,0,0.5))`, so scan with a balanced
  // paren counter instead.
  const stripVarCalls = (s: string): string => {
    let out = "";
    for (let i = 0; i < s.length; i += 1) {
      if (s.startsWith("var(", i)) {
        let depth = 0;
        let j = i;
        for (; j < s.length; j += 1) {
          const ch = s[j];
          if (ch === "(") depth += 1;
          else if (ch === ")") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        if (j < s.length && depth === 0) {
          i = j;
          continue;
        }
      }
      out += s[i];
    }
    return out;
  };

  it("has no bare literal #3b82f6 references outside :root and var() fallbacks", () => {
    expect(stripVarCalls(outsideRoot)).not.toMatch(/#3b82f6\b/i);
  });

  it("has no bare literal rgba(59, 130, 246, ...) references outside :root and var() fallbacks", () => {
    expect(stripVarCalls(outsideRoot)).not.toMatch(
      /rgba\(\s*59\s*,\s*130\s*,\s*246/,
    );
  });
});

// Issues #535 and #633: contrast is measured from the render, not the
// stylesheet. components/a11y.gate.ct.tsx mounts every participant-facing
// component in each state a participant puts it in, and the browser reads
// what is on screen — axe for text, a computed-style mark for an opaque
// non-text indicator, a painted pixel for the rest. A palette gate used to
// live here instead: hand-written token pairings, scored by a
// reimplementation of CSS colour resolution. A third of its pairings named a
// combination nothing rendered, the algebra had defects of its own, and the
// one thing it could do that the gate cannot needs no colour maths at all.
//
// That one thing is the LEDGER. Axe can only see what renders: it cannot
// tell you about a token nobody wired up (#616 found --stagebook-timer-warn
// declared and read by nothing), or about a canvas. So every colour token is
// either MEASURED — consumed by a component the gate mounts, in a state it
// scans — or EXCLUDED here with a reason. A new token has to be classified
// before this passes; a removed one has to be un-listed.
describe("every colour token is measured in the a11y gate or excluded with a reason (#633)", () => {
  const css = readFileSync(stylesPath, "utf8");
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rootBody = /:root\s*\{([\s\S]*?)\}/.exec(noComments)?.[1] ?? "";

  /** Each token's first declaration. */
  const declared = new Map<string, string>();
  for (const m of noComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (!declared.has(m[1])) {
      declared.set(m[1], m[2].trim().replace(/\s+/g, " "));
    }
  }
  // Fail closed: a token is a colour unless its value has the shape of a
  // length, a bare number, or a font stack. A named colour, an hsl() or an
  // oklch() the palette has not used yet counts as a colour and has to be
  // classified, rather than slipping past a list of known colour syntaxes.
  const NON_COLOUR = /^(\d[\d.]*(rem|em|px|%)?|"|ui-)/;
  const colourTokens = [...declared]
    .filter(
      ([name, value]) =>
        name.startsWith("--stagebook-") && !NON_COLOUR.test(value),
    )
    .map(([name]) => name);

  /**
   * Token → the a11y gate case(s) whose render it is read from. The open
   * picker's rows exist only under `appearance: base-select`, so entries
   * naming them are measured on Chromium and WebKit and skipped on Firefox
   * (#627).
   */
  const MEASURED: Record<string, string> = {
    "--stagebook-primary":
      "Button; Markdown link; RadioGroup and CheckboxGroup checked fills; the open picker's checkmark",
    "--stagebook-primary-hover":
      "Button, Markdown link and TrackedLink, hovered",
    "--stagebook-primary-active": "Button, pressed",
    "--stagebook-primary-tint":
      "Slider (ticks), track hovered — the backdrop the ticks and thumb are read against, in both its color-mix and static branches",
    "--stagebook-success": "Prompt: open response (within limits)",
    "--stagebook-danger":
      "ElementErrorBoundary; KitchenTimer (warning); Timeline (no player); Timeline (ranges), track muted",
    "--stagebook-danger-bg": "ElementErrorBoundary",
    "--stagebook-playhead": "Timeline — the line, and the time box",
    "--stagebook-playhead-fg": "Timeline — the time box",
    "--stagebook-timer-fill": "KitchenTimer",
    "--stagebook-text": "every case with body text",
    "--stagebook-text-secondary":
      "Button (secondary); KitchenTimer; AssetPlaceholder",
    "--stagebook-text-muted":
      "RadioGroup and CheckboxGroup labels; Display; Prompt: slider labels; Select (placeholder) trigger",
    "--stagebook-choice-border":
      "RadioGroup and CheckboxGroup unchecked outlines, including hovered rows",
    "--stagebook-slider-tick":
      "Slider (ticks), including the known minor-tick contrast shortfall (#616)",
    "--stagebook-timeline-ruler-text": "Timeline ruler timestamps",
    "--stagebook-border": "TextArea (a known failure, #616)",
    "--stagebook-bg":
      "Slider (ticks) value badge text; the page, which the gate paints from it and reads behind every PAGE-backed mark",
    "--stagebook-bg-muted":
      "AssetPlaceholder; Display; Markdown (rich) table header; ListSorter",
    "--stagebook-bg-track":
      "KitchenTimer track; Slider track; Button (secondary), pressed",
    "--stagebook-hover-bg":
      "RadioGroup, CheckboxGroup, ListSorter and Select rows, Button (secondary) and Markdown (rich) table rows, hovered; the walked picker row",
    "--stagebook-surface":
      "Select trigger and picker rows; TextArea, through the stylesheet's form reset",
    "--stagebook-focus-ring":
      "Button — the ring resolved on a probe against the page; Select (picker open), row walked — the inset ring on the row's fill. Its layering, opacity and forced-colors survival are focus.gate.ct.tsx's (#610)",
    "--stagebook-timeline-tooltip-bg":
      "Timeline (ranges), handle hovered — the color-mix branch by axe, the static fallback from the paint",
    "--stagebook-timeline-tooltip-fg":
      "Timeline (ranges), handle hovered, in both branches",
    "--stagebook-link": "Markdown",
    "--stagebook-link-hover": "Markdown, link hovered",
    "--stagebook-link-visited":
      "Markdown — resolved by the browser on a probe, since :visited cannot be driven",
    "--stagebook-code-bg": "Markdown (rich)",
    "--stagebook-table-text": "Markdown (rich)",
    "--stagebook-table-header-text": "Markdown (rich)",
    "--stagebook-blockquote-bg": "Display; Markdown (rich)",
  };

  /**
   * Token → why no render is measured. A reason starting `unconsumed:` is
   * checked: the token must stay unread, or it has to move to MEASURED.
   */
  const EXCLUDED: Record<string, string> = {
    "--stagebook-decoration":
      "aria-hidden AssetPlaceholder icon and Loading arc; readable text and functional indicators have separate tokens (#616)",
    "--stagebook-warning":
      "a 300ms glow around the character counter on an overflow attempt (TextArea.tsx): transient motion beside the counter text, not an indicator a participant has to read",
    "--stagebook-success-bg":
      "unconsumed: a status pair declared for hosts; no stagebook component renders it",
    "--stagebook-warning-bg":
      "unconsumed: a status pair declared for hosts; no stagebook component renders it",
    "--stagebook-timer-warn":
      "unconsumed: KitchenTimer reads --stagebook-danger for its warning fill (#616)",
    "--stagebook-timer-track":
      "unconsumed: KitchenTimer reads --stagebook-bg-track for its track",
    "--stagebook-waveform-color": "canvas — no reader in the gate can see it",
    "--stagebook-waveform-track-bg":
      "canvas, and translucent over whatever the host paints behind the timeline",
    "--stagebook-spinner-track":
      "the Loading spinner's SVG ring: animation with an accessible name, not a boundary a participant has to find (1.4.11)",
    "--stagebook-spinner-arc":
      "the Loading spinner's SVG arc, as the track above",
    "--stagebook-scroll-indicator-bg":
      "an aria-hidden chevron pill, translucent by design over page content that varies",
    "--stagebook-scroll-indicator-fg":
      "the chevron on that pill: aria-hidden decoration",
    "--stagebook-timeline-range-active":
      "a translucent selection fill over the waveform canvas; its job is telling states apart, and it has no fixed backdrop",
    "--stagebook-timeline-range-active-border":
      "drawn over the waveform canvas",
    "--stagebook-timeline-range-inactive":
      "a translucent selection fill over the waveform canvas, as the active one",
    "--stagebook-timeline-range-inactive-border":
      "drawn over the waveform canvas",
    "--stagebook-timeline-handle-active": "drawn over the waveform canvas",
    "--stagebook-timeline-handle-inactive": "drawn over the waveform canvas",
    "--stagebook-timeline-preview-bg":
      "the drag preview's fill over the waveform canvas",
    "--stagebook-timeline-preview-border":
      "the drag preview's edge over the waveform canvas",
    "--stagebook-timeline-track-label-bg":
      "85% white over the waveform canvas; the gate records the label on it as unmeasured — 4.02:1 over a bar, by hand (#616)",
    "--stagebook-timeline-minimap-viewport-border":
      "minimap chrome over the waveform canvas",
    "--stagebook-timeline-minimap-viewport-bg":
      "minimap chrome over the waveform canvas",
    "--stagebook-timeline-minimap-range":
      "minimap chrome over the waveform canvas",
    "--stagebook-timeline-minimap-point":
      "minimap chrome over the waveform canvas",
    "--stagebook-blockquote-border":
      "a decorative quote rail; the panel tint and the indent identify the quote (1.4.11 exempts decoration)",
  };

  it("classifies every colour token, exactly once", () => {
    const listed = [...Object.keys(MEASURED), ...Object.keys(EXCLUDED)];
    expect(
      Object.keys(MEASURED).filter((t) => t in EXCLUDED),
      "in both lists",
    ).toEqual([]);
    expect(
      colourTokens.filter((t) => !listed.includes(t)),
      "unclassified — read it from a render in a11y.gate.ct.tsx, or exclude it here with the reason",
    ).toEqual([]);
    expect(
      listed.filter((t) => !colourTokens.includes(t)),
      "listed, but not a colour token styles.css declares",
    ).toEqual([]);
  });

  it("a measured token is read by a component, and an unconsumed one by nothing", () => {
    // The gate can only see a token something renders. A token consumed by
    // no component is invisible to it, however many cases are mounted — so
    // it has to be excluded as `unconsumed:`, and if a component starts to
    // read it, this says so.
    const referenced = new Set<string>();
    for (const file of collectFiles(componentsDir)) {
      if (/\.(test|ct)\.tsx?$/.test(file) || file.includes("/testing/")) {
        continue;
      }
      for (const name of extractReferenced(readFileSync(file, "utf8"))) {
        referenced.add(name);
      }
    }
    // The stylesheet's own rule bodies read tokens too (its form reset is
    // how TextArea gets --stagebook-surface). Its :root blocks declare
    // rather than read, so they are stripped first.
    for (const name of extractReferenced(
      noComments.replace(/:root\s*\{[^}]*\}/g, ""),
    )) {
      referenced.add(name);
    }
    expect(
      Object.keys(MEASURED).filter((t) => !referenced.has(t)),
      "measured, but no component reads it — the gate cannot be seeing it",
    ).toEqual([]);
    expect(
      Object.entries(EXCLUDED)
        .filter(([, why]) => why.startsWith("unconsumed:"))
        .map(([t]) => t)
        .filter((t) => referenced.has(t)),
      "excluded as unconsumed, but a component now reads it — measure it",
    ).toEqual([]);
  });

  it("keeps each timeline time box on its own foreground token", () => {
    // The gate measures these from the render, which is only meaningful
    // while the components actually read the tokens. Reverting to a
    // hard-coded `white` would leave a host's retuned box unmeasured, and
    // restore the theming gap #619 closed. Asserting BOTH names also pins
    // the split itself: collapsing them back to one shared foreground is
    // the #629 finding, where a host retuning one of the two backgrounds
    // has no value readable on both.
    const timelineStyles = readFileSync(
      join(componentsDir, "elements", "timeline", "timelineStyles.ts"),
      "utf8",
    );
    expect(timelineStyles).toContain(
      "var(--stagebook-timeline-tooltip-fg, #fff)",
    );
    expect(timelineStyles).toContain("var(--stagebook-playhead-fg, #fff)");
    // And the shared base must stay colourless, or one surface silently wins.
    const base = /tooltipBaseStyle[^}]*}/s.exec(timelineStyles)?.[0] ?? "";
    expect(base).not.toMatch(/color:/);
  });

  it("honors a deprecated --stagebook-text-faint override through --stagebook-decoration", () => {
    // Back-compat: components read --stagebook-decoration, so it must fall
    // through the old --stagebook-text-faint token first (a host that still
    // overrides the old name must keep working).
    expect(declared.get("--stagebook-decoration")).toMatch(
      /var\(\s*--stagebook-text-faint\b/,
    );
  });

  it("pins color-scheme: light so participant OS dark mode can't re-tint native controls", () => {
    expect(rootBody).toMatch(/color-scheme:\s*light/);
  });

  it("keeps --stagebook-playhead its own hue — rose, never the accent or danger (#535)", () => {
    // A host rebranding the accent (or danger) must not move the playhead
    // marker: it aliases its own primitive, not another semantic token.
    expect(declared.get("--stagebook-playhead")).toBe("var(--sb-rose-700)");
    expect(declared.get("--sb-rose-700")).toBe("#be123c");
  });

  it("every inline fallback equals its token's default, so a stylesheet-free host renders this palette's static branch (#213)", () => {
    // Components carry `var(--stagebook-x, <literal>)` so they render on a
    // host that never imports this stylesheet. Each literal is a second
    // copy of the default, and copies drift — #535 retuned the accent and
    // the old blue lingered in inline literals. Holding every copy to its
    // declaration means the stylesheet-free render IS the static branch the
    // gate already scans, so it needs no scan of its own. Alias-following
    // only: no colour arithmetic. (Two canvas tokens are read in JS with a
    // `||` fallback instead; the ledger excludes them as canvas.)

    /** First top-level comma in `s`, or -1. */
    const topLevelComma = (s: string): number => {
      let depth = 0;
      for (let i = 0; i < s.length; i += 1) {
        if (s[i] === "(") depth += 1;
        else if (s[i] === ")") depth -= 1;
        else if (s[i] === "," && depth === 0) return i;
      }
      return -1;
    };
    /** Every `var(…)` in `src`, by balanced parens: its span, name and fallback. */
    const varsIn = (src: string) => {
      const out: { end: number; name: string; fallback?: string }[] = [];
      for (
        let i = src.indexOf("var(");
        i >= 0;
        i = src.indexOf("var(", i + 4)
      ) {
        let depth = 0;
        let j = i + 3;
        for (; j < src.length; j += 1) {
          if (src[j] === "(") depth += 1;
          else if (src[j] === ")" && (depth -= 1) === 0) break;
        }
        const inner = src.slice(i + 4, j);
        const comma = topLevelComma(inner);
        out.push({
          end: j,
          name: (comma < 0 ? inner : inner.slice(0, comma)).trim(),
          fallback: comma < 0 ? undefined : inner.slice(comma + 1).trim(),
        });
      }
      return out;
    };
    /** `value` when it is exactly one `var(…)`, parsed; else null. */
    const asVar = (value: string) => {
      const v = value.startsWith("var(") ? varsIn(value)[0] : undefined;
      return v && v.end === value.length - 1 ? v : null;
    };
    /** A value with the stylesheet: itself, or the default of the token it aliases. */
    const withStylesheet = (
      value: string,
      seen = new Set<string>(),
    ): string | undefined => {
      const ref = asVar(value);
      if (!ref) return value;
      if (seen.has(ref.name)) return undefined;
      const decl = declared.get(ref.name);
      // `initial` gives an unregistered custom property the guaranteed-invalid
      // value, so the browser uses this reference's fallback (#651).
      return decl === undefined || decl === "initial"
        ? ref.fallback === undefined
          ? undefined
          : withStylesheet(ref.fallback, seen)
        : withStylesheet(decl, new Set(seen).add(ref.name));
    };
    /** A value without the stylesheet: every token is undefined, so its fallback. */
    const withoutStylesheet = (value: string): string | undefined => {
      const ref = asVar(value);
      if (!ref) return value;
      return ref.fallback === undefined
        ? undefined
        : withoutStylesheet(ref.fallback);
    };
    // Whitespace and hex shorthand are the only differences a copy may have.
    const normalise = (s: string) =>
      s
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, "#$1$1$2$2$3$3");

    const sources: [string, string][] = collectFiles(componentsDir)
      .filter((f) => !/\.(test|ct)\.tsx?$/.test(f) && !f.includes("/testing/"))
      .map((f) => [f.slice(here.length + 1), readFileSync(f, "utf8")]);
    // The stylesheet's own rule bodies carry fallbacks too (its form reset).
    sources.push(["styles.css", noComments.replace(/:root\s*\{[^}]*\}/g, "")]);

    const drifted: string[] = [];
    const bare: string[] = [];
    for (const [file, src] of sources) {
      for (const v of varsIn(src)) {
        if (!v.name.startsWith("--stagebook-")) continue;
        if (v.fallback === undefined) {
          bare.push(`${file}: var(${v.name}) has no fallback`);
          continue;
        }
        const expected = withStylesheet(`var(${v.name}, ${v.fallback})`);
        const actual = withoutStylesheet(v.fallback);
        if (
          expected === undefined ||
          actual === undefined ||
          normalise(expected) !== normalise(actual)
        ) {
          drifted.push(
            `${file}: var(${v.name}, ${v.fallback}) — the default is ${expected ?? "not declared"}`,
          );
        }
      }
    }
    expect(
      drifted,
      "inline fallbacks that differ from the token's default",
    ).toEqual([]);
    expect(bare, "references a stylesheet-free host cannot resolve").toEqual(
      [],
    );
  });
});
