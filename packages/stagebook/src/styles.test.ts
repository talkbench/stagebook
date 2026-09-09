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
// skips translucent values by design — see #612).
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
    // palette gate skips both — they're translucent, so there's no single
    // opaque hex to assert a ratio against — which is exactly why this
    // separate guard exists.
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
/**
 * Resolver over a token -> declarations map. A factory rather than closure
 * state so the resolution rules can be exercised against a synthetic palette
 * (see the isolation tests below) and not only against the real styles.css.
 */
function makeResolver(vars: Map<string, string[]>) {
  /** Split on commas that are not inside parentheses. */
  function splitTopLevel(input: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of input) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    parts.push(current);
    return parts;
  }

  /**
   * The opaque hex a literal denotes, or null when it denotes none.
   *
   * The loose `#[0-9a-f]{3,8}` this replaces was the gate's last
   * silently-wrong path: it accepted 4- and 8-digit hex, whose alpha channel
   * the channel reader then dropped on the floor — scoring a translucent
   * color as fully opaque — and accepted 5- and 7-digit strings that are not
   * valid CSS at all. Everything else in the resolver fails loudly; this one
   * answered confidently and wrongly.
   */
  function opaqueHex(v: string): string | null {
    const m = /^#([0-9a-f]+)$/i.exec(v);
    if (!m) return null;
    const h = m[1];
    if (h.length === 3 || h.length === 6) return v;
    // 4- and 8-digit forms carry alpha: usable only when fully opaque, and
    // then only with the alpha stripped so the channel reader sees rgb.
    if (h.length === 4) return /^f$/i.test(h[3]) ? `#${h.slice(0, 3)}` : null;
    if (h.length === 8)
      return /^ff$/i.test(h.slice(6)) ? `#${h.slice(0, 6)}` : null;
    return null;
  }

  /** Split a hex (3- or 6-digit) into its r/g/b channels. */
  function channels(hex: string): number[] {
    const h = hex.replace("#", "");
    const n =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  }

  /** Blend two opaque hexes: `a` at `p`, `b` at the remainder. */
  function blend(a: string, b: string, p: number): string {
    const [ar, ag, ab] = channels(a);
    const [br, bg, bb] = channels(b);
    return (
      "#" +
      [
        [ar, br],
        [ag, bg],
        [ab, bb],
      ]
        .map(([x, y]) =>
          Math.round(x * p + y * (1 - p))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }

  /** Composite an r/g/b triple at alpha `a` over an opaque backdrop hex. */
  function compositeOver(rgb: number[], a: number, backdrop: string): string {
    const bd = channels(backdrop);
    return (
      "#" +
      rgb
        .map((v, i) =>
          Math.round(v * a + bd[i] * (1 - a))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }

  /**
   * `rgb()` / `rgba()`. Opaque values give one hex. A translucent value has
   * no single rendered color — it depends on the backdrop, which for the
   * timeline tooltip may be a lane, a waveform bar or a selection range. So
   * rather than guess (or skip it, which is exactly how #610 slipped past
   * this gate), return the two colors that BOUND every possible backdrop:
   * composited over pure white and pure black. Asserting both means the
   * contrast floor holds whatever ends up behind it — white being the worst
   * case for light text and black for dark text, so the pair covers either
   * direction without the resolver needing to know the foreground.
   */
  function resolveRgb(v: string): string[] {
    const m = /^rgba?\(([^)]+)\)$/i.exec(v);
    if (!m) return [];
    const parts = m[1].split(/[,/]/).map((x) => x.trim());
    if (parts.length < 3 || parts.length > 4) return [];
    const rgb = parts.slice(0, 3).map(Number);
    if (rgb.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return [];
    const a = parts.length === 4 ? Number(parts[3]) : 1;
    if (!Number.isFinite(a) || a < 0 || a > 1) return [];
    if (a === 1) return [compositeOver(rgb, 1, "#000000")];
    return [compositeOver(rgb, a, "#ffffff"), compositeOver(rgb, a, "#000000")];
  }

  /**
   * Every opaque hex one declared value can resolve to — a list, not a single
   * value, because a declaration may reach a token that itself has several
   * (#612 review). Collapsing to one here would re-open the effective-value
   * blind spot one hop away: --stagebook-link aliases --stagebook-primary, so
   * an @supports override on primary is what browsers render for links too.
   *
   * Empty when the value has no opaque hex at all — a translucent rgba, or a
   * mix toward `transparent`. A contrast assertion against those would be
   * meaningless, so the caller asserts the token resolved to something.
   */
  function resolveValues(v: string, seen: Set<string>): string[] {
    if (v.startsWith("#")) {
      const hex = opaqueHex(v);
      return hex ? [hex] : [];
    }
    if (/^rgba?\(/i.test(v)) return resolveRgb(v);
    if (/^var\(\s*--[\w-]+\s*\)$/.test(v)) {
      const ref = /var\(\s*(--[\w-]+)/.exec(v);
      return ref ? resolveAllHexes(ref[1], seen) : [];
    }
    // `color-mix(in srgb, <color> [N%], <color> [N%])`. A mix toward
    // `transparent` stays translucent and drops out; a mix toward an opaque
    // color (e.g. the timeline tooltip's `… 80%, #000`) has a real hex worth
    // asserting. Each side can itself be multi-valued, so the result is every
    // combination.
    //
    // Both percentages are optional and either may carry one — all of
    // `A 80%, B`, `A 80%, B 20%`, `A, B 20%` and `A, B` are valid CSS. An
    // earlier version matched only the first form and silently dropped the
    // rest, which (because the token usually also has an opaque fallback)
    // left the effective override untested while the gate still looked green
    // (#617 review).
    const mix = /^color-mix\(\s*in srgb\s*,\s*(.+)\)$/i.exec(v);
    if (!mix) return [];
    const sides = splitTopLevel(mix[1]);
    if (sides.length !== 2) return [];
    const parsed = sides.map((side) => {
      const withPct = /^(.*?)\s+([\d.]+)%$/.exec(side.trim());
      return withPct
        ? { color: withPct[1].trim(), pct: parseFloat(withPct[2]) }
        : { color: side.trim(), pct: null as number | null };
    });
    // Fill in the omitted weight, then normalize: CSS scales the pair to sum
    // to 100% when they don't (so `40%, 40%` is an even mix, not a dark one).
    const [rawP1, rawP2] = [parsed[0].pct, parsed[1].pct];
    const p1 = rawP1 ?? (rawP2 === null ? 50 : 100 - rawP2);
    const p2 = rawP2 ?? 100 - p1;
    const total = p1 + p2;
    if (total <= 0) return [];
    // Weights summing UNDER 100% do not just renormalize: CSS applies the
    // shortfall as an alpha multiplier, so `40%, 40%` is a translucent grey,
    // not an opaque one. There is no opaque hex to score, so skip it — the
    // same treatment as a mix toward `transparent`. (Over 100% is a plain
    // scale-down and stays opaque. A single explicit weight can't get here:
    // the omitted one is filled to make exactly 100.)
    if (total < 100) return [];
    const p = p1 / total;

    const out: string[] = [];
    for (const a of resolveValues(parsed[0].color, new Set(seen))) {
      for (const b of resolveValues(parsed[1].color, new Set(seen))) {
        out.push(blend(a, b, p));
      }
    }
    return out;
  }

  /**
   * What each declaration of a token resolved to, keeping them separate.
   *
   * The pairing needs this, not just the flattened list: a token whose
   * @supports override resolves and whose static fallback does not still
   * produces a non-empty list, so a "resolved to something" check passes
   * while the fallback — what a browser without color-mix actually paints —
   * goes unscored (#617 review). Coverage has to be per declaration.
   */
  function resolveDeclarations(
    name: string,
    seen = new Set<string>(),
  ): { value: string; hexes: string[] }[] {
    if (seen.has(name)) return [];
    seen.add(name);
    return (vars.get(name) ?? []).map((value) => ({
      value,
      hexes: resolveValues(value, new Set(seen)),
    }));
  }

  /**
   * Every resolvable opaque value a token can take — the static default and
   * any @supports override. Both ship, so both are asserted: the fallback is
   * what an old browser renders, the override is what everything else does.
   */
  function resolveAllHexes(name: string, seen = new Set<string>()): string[] {
    if (seen.has(name)) return [];
    seen.add(name);
    // A FRESH clone per declaration (#612 review). Sharing one mutable set
    // across a token's declarations lets an earlier value that follows an
    // alias poison the later ones: the alias lands in `seen`, and the next
    // declaration referencing the same token is mistaken for a cycle and
    // dropped. That silently removes an assertion — the exact failure mode
    // this gate exists to prevent. Cloning keeps self-reference detection
    // (the token itself is already in `seen`) while isolating siblings.
    const all = (vars.get(name) ?? []).flatMap((v) =>
      resolveValues(v, new Set(seen)),
    );
    return [...new Set(all)];
  }

  /** The token's primary (first-declared) resolvable value, or null. */
  function resolveHex(name: string, seen = new Set<string>()): string | null {
    return resolveAllHexes(name, seen)[0] ?? null;
  }
  return { resolveHex, resolveAllHexes, resolveDeclarations };
}

// #612 review. The resolver walks a token's declarations to find every opaque
// value it can take. If those walks share one mutable cycle-tracking set, an
// earlier declaration that follows an alias poisons the later ones — and the
// symptom is a silently MISSING assertion, not a failing one, which is the
// precise failure this gate was written to end.
describe("the resolver isolates a token's declarations from each other", () => {
  it("still resolves a color-mix override when the fallback aliases the same token", () => {
    // Exactly the shape flagged in review: a static fallback that aliases
    // --primary, then an @supports override that mixes the same token.
    const { resolveAllHexes } = makeResolver(
      new Map([
        ["--primary", ["#2563eb"]],
        [
          "--tooltip-bg",
          ["var(--primary)", "color-mix(in srgb, var(--primary) 80%, #000)"],
        ],
      ]),
    );
    // Both must survive. With a shared `seen`, the first declaration adds
    // --primary to it and the mix is then dropped as a false cycle, leaving
    // the effective browser value untested.
    expect(resolveAllHexes("--tooltip-bg")).toEqual(["#2563eb", "#1e4fbc"]);
  });

  it("propagates every branch through an alias", () => {
    // --stagebook-link aliases --stagebook-primary. If the aliased token ever
    // gains an @supports override, browsers use it for the alias too — so
    // resolving the alias to a single value re-opens the exact effective-value
    // blind spot this gate closes, just one hop away.
    const { resolveAllHexes } = makeResolver(
      new Map([
        ["--primary", ["#2563eb", "color-mix(in srgb, #2563eb 80%, #000)"]],
        ["--link", ["var(--primary)"]],
      ]),
    );
    expect(resolveAllHexes("--link")).toEqual(["#2563eb", "#1e4fbc"]);
  });

  // A declaration either has an opaque hex the gate can score, or it does
  // not. The dangerous answers are neither red nor green — they're a WRONG
  // hex returned confidently, because the contrast maths then runs on a
  // color the browser never paints. Each row below is a value CSS considers
  // valid; `[]` means "no opaque hex", which the pairing assertion surfaces
  // loudly as "should resolve to at least one hex".
  it.each([
    // [declaration, expected, why this form exists]
    ["color-mix(in srgb, #ffffff 80%, #000000)", ["#cccccc"], "one percentage"],
    [
      "color-mix(in srgb, #ffffff 80%, #000000 20%)",
      ["#cccccc"],
      "both percentages",
    ],
    [
      "color-mix(in srgb, #ffffff, #000000 20%)",
      ["#cccccc"],
      "percentage on the second color only",
    ],
    ["color-mix(in srgb, #ffffff, #000000)", ["#808080"], "no percentage"],
    [
      "color-mix(in srgb, #ffffff 70%, #000000 70%)",
      ["#808080"],
      "weights over 100% are scaled down, and stay opaque",
    ],
    [
      "color-mix(in srgb, #ffffff 40%, #000000 40%)",
      [],
      "weights UNDER 100% make the result translucent — CSS applies the shortfall as an alpha multiplier, so there is no opaque hex to score",
    ],
    // Hex literals. 3 and 6 digits are opaque by definition; 4 and 8 carry an
    // alpha channel that must not be silently discarded; other lengths are
    // not valid CSS hex at all.
    ["#fff", ["#fff"], "3-digit"],
    ["#ffffff", ["#ffffff"], "6-digit"],
    ["#ffff", ["#fff"], "4-digit, fully opaque alpha"],
    ["#ffffffff", ["#ffffff"], "8-digit, fully opaque alpha"],
    ["#fff8", [], "4-digit with real alpha is translucent"],
    ["#ffffff80", [], "8-digit with real alpha is translucent"],
    ["#fffff", [], "5 digits is not valid CSS hex"],
    ["#fffffff", [], "7 digits is not valid CSS hex"],
    // Translucent colors have no single rendered value — they depend on what
    // is behind them, which for the timeline tooltip is a lane, a waveform
    // bar or a selection range. Rather than guess a backdrop (or skip them,
    // which is how #610 got in), resolve them to the two colors that BOUND
    // every possible backdrop: composited over pure white and pure black.
    // The pairing then asserts both, so the floor holds whatever is behind.
    // White is the worst case for light text, black for dark text, so the
    // pair covers either direction without knowing the foreground.
    [
      "rgba(30, 64, 175, 0.9)",
      ["#3453b7", "#1b3a9e"],
      "translucent: bounded over white and black",
    ],
    ["rgba(37, 99, 235, 1)", ["#2563eb"], "alpha 1 is just opaque"],
    ["rgb(255, 255, 255)", ["#ffffff"], "rgb() with no alpha"],
    // Forms the gate cannot evaluate. These resolve to nothing, which fails
    // LOUDLY at the pairing (\"should resolve to at least one hex\") rather
    // than quietly scoring the wrong color — the safe direction to be wrong
    // in. Teach the resolver about them the day a pairing needs one.
    ["white", [], "named colors are not parsed"],
    ["var(--x, #ff0000)", [], "var() with a fallback is not parsed"],
    ["color-mix(in oklab, #fff 50%, #000)", [], "only srgb mixes are parsed"],
  ])("resolves %s -> %j (%s)", (decl, expected) => {
    const { resolveAllHexes } = makeResolver(new Map([["--t", [decl]]]));
    expect(resolveAllHexes("--t")).toEqual(expected);
  });

  it("still detects a genuine self-referential cycle", () => {
    // The isolation must not cost cycle protection: a token that resolves to
    // itself has to terminate and yield nothing, not recurse.
    const { resolveAllHexes } = makeResolver(
      new Map([
        ["--a", ["var(--b)"]],
        ["--b", ["var(--a)"]],
      ]),
    );
    expect(resolveAllHexes("--a")).toEqual([]);
  });
});

describe("styles.css palette meets WCAG 2.2 AA by construction (#535)", () => {
  const css = readFileSync(stylesPath, "utf8");
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // The main :root block (custom-property values use parens, never braces,
  // so the first close-brace ends the block).
  // The main :root block, for assertions that are specifically about it.
  const rootBody = /:root\s*\{([\s\S]*?)\}/.exec(noComments)?.[1] ?? "";

  // EVERY declaration of each token, in source order — not just the first
  // (#612). The @supports(color-mix) block re-declares a dozen tokens, and on
  // any browser that supports color-mix those overrides are the palette that
  // actually renders. Reading only the first :root block asserted the static
  // fallbacks and left the effective values untested.
  const vars = new Map<string, string[]>();
  for (const m of noComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const prev = vars.get(m[1]) ?? [];
    prev.push(m[2].trim().replace(/\s+/g, " "));
    vars.set(m[1], prev);
  }

  const { resolveHex, resolveDeclarations } = makeResolver(vars);

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
    // The Select picker (#627) draws the option rows in-page, on the form
    // control surface rather than the page, so the text/surface pairings
    // are now on screen as rows and not only inside a closed trigger. The
    // hovered row swaps the surface for the hover fill; the checked row's
    // checkmark and the walked row's inset focus ring are non-text
    // indicators, so they need 3:1 on everything they sit on.
    [
      "--stagebook-text",
      "--stagebook-surface",
      AA,
      "select trigger + picker row text",
    ],
    ["--stagebook-text", "--stagebook-hover-bg", AA, "hovered picker row text"],
    ["--stagebook-primary", "--stagebook-surface", UI, "picker checkmark (UI)"],
    // The picker opens with the checked row walked, and a walked or hovered
    // row takes the hover fill — so this is the first thing a keyboard user
    // sees, not an edge case.
    [
      "--stagebook-primary",
      "--stagebook-hover-bg",
      UI,
      "picker checkmark on a hovered / walked checked row (UI)",
    ],
    [
      "--stagebook-focus-ring",
      "--stagebook-surface",
      UI,
      "inset focus ring on a picker row",
    ],
    [
      "--stagebook-focus-ring",
      "--stagebook-hover-bg",
      UI,
      "inset focus ring on a hovered picker row",
    ],
    // NOTE: --stagebook-border (gray-300, 1.47:1 on white) is a deliberately
    // subtle input border and predates #535 — the WCAG 1.4.11 question for
    // form-control boundaries is a separate a11y decision, not asserted here.
    ["--stagebook-playhead", "--stagebook-bg", UI, "playhead marker (UI)"],
    // #612. The tooltip's text is a hard-coded `white` in timelineStyles.ts,
    // so the foreground here is the literal — NOT --stagebook-bg, which only
    // happens to be white today. Using the token as a proxy would silently
    // start asserting the wrong pairing the moment a host (or a future
    // darker palette) moved it, while the rendered text stayed white
    // (#617 review). The literal is pinned to its source by the test below.
    // Only assertable at all now that the gate resolves the @supports form:
    // this token's static fallback is translucent, its effective value is not.
    [
      "#ffffff",
      "--stagebook-timeline-tooltip-bg",
      AA,
      "timeline range tooltip text (literal white)",
    ],
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
    // Every shipped value of each token, not just the first (#612): a token
    // re-declared under @supports has two, and both render somewhere — the
    // static one on a browser without color-mix, the override everywhere
    // else. Asserting only the first tested the palette almost nobody sees.
    // A side may be a literal hex rather than a token: some rendered colors
    // are hard-coded in a component and are not themeable, so asserting a
    // token "as a proxy" for them would compute a pairing that isn't on
    // screen the moment that token moves (#617 review).
    const asHexes = (side: string) => {
      if (side.startsWith("#")) return [side];
      // EVERY declaration has to be scoreable, not just one of them. A token
      // whose @supports override resolves and whose static fallback doesn't
      // would otherwise pass this check while the fallback — what a browser
      // without color-mix paints — went untested (#617 review).
      const decls = resolveDeclarations(side);
      expect(decls, `${side} is not declared anywhere`).not.toEqual([]);
      for (const d of decls) {
        expect(
          d.hexes,
          `${side} declares \`${d.value}\`, which this gate cannot score — ` +
            `teach the resolver that form, or the pairing is only checking ` +
            `the other declarations`,
        ).not.toEqual([]);
      }
      return decls.flatMap((d) => d.hexes);
    };
    const fgHexes = asHexes(fg);
    const bgHexes = asHexes(bg);
    for (const fgHex of fgHexes) {
      for (const bgHex of bgHexes) {
        const ratio = contrast(fgHex, bgHex);
        expect(
          ratio,
          `${fg} (${fgHex}) on ${bg} (${bgHex}) = ${ratio.toFixed(2)}:1, need ${String(min)}`,
        ).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("pins the tooltip's hard-coded text color to the pairing above", () => {
    // The pairing asserts a literal #ffffff because that is what renders.
    // If the tooltip's text color ever changes, this fails and forces the
    // pairing to be updated with it — otherwise the two drift silently and
    // the contrast assertion quietly stops describing the screen.
    const timelineStyles = readFileSync(
      join(componentsDir, "elements", "timeline", "timelineStyles.ts"),
      "utf8",
    );
    expect(timelineStyles).toMatch(/color:\s*"white"/);
  });

  it("honors a deprecated --stagebook-text-faint override through --stagebook-decoration", () => {
    // Back-compat: components read --stagebook-decoration, so it must fall
    // through the old --stagebook-text-faint token first (a host that still
    // overrides the old name must keep working).
    expect(vars.get("--stagebook-decoration")?.[0]).toMatch(
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
