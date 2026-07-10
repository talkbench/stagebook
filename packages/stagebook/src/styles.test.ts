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
    // --stagebook-focus-ring token. The focus-ring token must itself be
    // derivable from --stagebook-primary, either unconditionally OR inside
    // an @supports(color-mix) override — the unconditional default may be
    // a static rgba so browsers without color-mix keep a visible ring.
    const focusRingDerivesFromPrimary =
      /--stagebook-focus-ring\s*:\s*color-mix\([^)]*var\(--stagebook-primary/;
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
    const ref = /var\(\s*(--[\w-]+)/.exec(v);
    return ref ? resolveHex(ref[1], seen) : null; // color-mix/rgba → null
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
    ["--stagebook-danger", "--stagebook-danger-bg", AA, "danger pill/callout"],
    ["--stagebook-success", "--stagebook-success-bg", AA, "success pill"],
    ["--stagebook-warning", "--stagebook-warning-bg", AA, "warning pill"],
    ["--stagebook-danger", "--stagebook-bg", AA, "danger text on white"],
    // NOTE: --stagebook-border (gray-300, 1.47:1 on white) is a deliberately
    // subtle input border and predates #535 — the WCAG 1.4.11 question for
    // form-control boundaries is a separate a11y decision, not asserted here.
    ["--stagebook-playhead", "--stagebook-bg", UI, "playhead marker (UI)"],
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

  it("keeps --stagebook-text-faint as a deprecated alias of --stagebook-decoration", () => {
    expect(vars.get("--stagebook-text-faint")).toContain(
      "var(--stagebook-decoration)",
    );
  });

  it("pins color-scheme: light so participant OS dark mode can't re-tint native controls", () => {
    expect(rootBody).toMatch(/color-scheme:\s*light/);
  });
});
