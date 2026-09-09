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
// both silently, since neither is something the palette gate can catch (it
// skips translucent tokens by design).
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
    // Two branches: the static rgba default and the color-mix upgrade. The
    // palette gate reads only the first :root block, so it sees neither.
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

// Issue #535: the palette is accessible *by construction* — every documented
// foreground/background pairing meets WCAG 2.2 AA. These tests resolve each
// --stagebook-* token through the two-tier alias graph (semantic → primitive)
// to a hex and assert the contrast ratio, so a future value edit that breaks
// contrast fails CI instead of shipping.
describe("styles.css palette meets WCAG 2.2 AA by construction (#535)", () => {
  const css = readFileSync(stylesPath, "utf8");
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // The main :root block (custom-property values use parens, never braces,
  // so the first close-brace ends the block).
  const rootBody = /:root\s*\{([\s\S]*?)\}/.exec(noComments)?.[1] ?? "";
  const vars = new Map<string, string>();
  for (const m of rootBody.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].trim());
  }

  /** Resolve a token through var() aliases to a solid hex, or null. */
  function resolveHex(name: string, seen = new Set<string>()): string | null {
    if (seen.has(name)) return null;
    seen.add(name);
    const v = vars.get(name);
    if (!v) return null;
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
    // Only follow a plain `var(--x)` alias to a solid hex. A color-mix()/rgba()
    // value is a translucent/blended color with no single opaque hex, so a
    // contrast assertion against it would be meaningless — return null (the
    // caller asserts the token resolved) rather than the inner var's opaque hex.
    if (/^var\(\s*--[\w-]+\s*\)$/.test(v)) {
      const ref = /var\(\s*(--[\w-]+)/.exec(v);
      return ref ? resolveHex(ref[1], seen) : null;
    }
    return null;
  }

  function relLum(hex: string): number {
    const h = hex.replace("#", "");
    const n =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
    const lin = ch.map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
    );
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrast(a: string, b: string): number {
    const la = relLum(a);
    const lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // [foreground token, background token, min ratio, label]
  const AA = 4.5; // normal text
  const UI = 3.0; // UI components / large text
  const pairings: [string, string, number, string][] = [
    ["--stagebook-text", "--stagebook-bg", AA, "body text on page"],
    ["--stagebook-text-secondary", "--stagebook-bg", AA, "secondary text"],
    ["--stagebook-text-muted", "--stagebook-bg", AA, "muted text"],
    ["--stagebook-primary", "--stagebook-bg", AA, "link text / TrackedLink"],
    ["--stagebook-bg", "--stagebook-primary", AA, "button label on primary"],
    ["--stagebook-link", "--stagebook-bg", AA, "markdown link text"],
    ["--stagebook-link-visited", "--stagebook-bg", AA, "visited link text"],
    ["--stagebook-danger", "--stagebook-danger-bg", AA, "danger pill/callout"],
    ["--stagebook-success", "--stagebook-success-bg", AA, "success pill"],
    ["--stagebook-warning", "--stagebook-warning-bg", AA, "warning pill"],
    ["--stagebook-danger", "--stagebook-bg", AA, "danger text on white"],
    // NOTE: --stagebook-border (gray-300, 1.47:1 on white) is a deliberately
    // subtle input border and predates #535 — the WCAG 1.4.11 question for
    // form-control boundaries is a separate a11y decision, not asserted here.
    ["--stagebook-playhead", "--stagebook-bg", UI, "playhead marker (UI)"],
    // #610: the focus ring is a non-text UI indicator (1.4.11), so it needs
    // 3:1 against everything it can abut. It was translucent until #610 —
    // and resolveHex() returns null for a translucent value, so it slipped
    // through this gate entirely while sitting at 1.03:1 against the very
    // border it's drawn beside. Opaque now, and asserted against both.
    ["--stagebook-focus-ring", "--stagebook-bg", UI, "focus ring on the page"],
    [
      "--stagebook-focus-ring",
      "--stagebook-border",
      UI,
      "focus ring against a control's own border",
    ],
  ];

  it.each(pairings)("%s on %s meets its contrast floor (%s)", (fg, bg, min) => {
    const fgHex = resolveHex(fg);
    const bgHex = resolveHex(bg);
    expect(fgHex, `${fg} should resolve to a hex`).not.toBeNull();
    expect(bgHex, `${bg} should resolve to a hex`).not.toBeNull();
    const ratio = contrast(fgHex as string, bgHex as string);
    expect(
      ratio,
      `${fg} (${String(fgHex)}) on ${bg} (${String(bgHex)}) = ${ratio.toFixed(2)}:1, need ${String(min)}`,
    ).toBeGreaterThanOrEqual(min);
  });

  it("honors a deprecated --stagebook-text-faint override through --stagebook-decoration", () => {
    // Back-compat: components read --stagebook-decoration, so it must fall
    // through the old --stagebook-text-faint token first (a host that still
    // overrides the old name must keep working).
    expect(vars.get("--stagebook-decoration")).toMatch(
      /var\(\s*--stagebook-text-faint\b/,
    );
  });

  it("pins color-scheme: light so participant OS dark mode can't re-tint native controls", () => {
    expect(rootBody).toMatch(/color-scheme:\s*light/);
  });

  it("keeps --stagebook-playhead independent of --stagebook-primary (rose, not the accent)", () => {
    // The playhead is deliberately its own hue — a host rebranding the accent
    // (or danger) must not move the playhead marker (#535).
    const playhead = resolveHex("--stagebook-playhead");
    expect(playhead).toBe("#be123c"); // rose-700
    expect(playhead).not.toBe(resolveHex("--stagebook-primary"));
    expect(playhead).not.toBe(resolveHex("--stagebook-danger"));
  });
});
