import { describe, test, expect } from "vitest";
import { validateDispatcherConfig } from "./validateDispatcherConfig.js";

const T2 = ["t0", "t1"];
const T3 = ["t0", "t1", "t2"];

describe("validateDispatcherConfig", () => {
  test("rejects non-object configs", () => {
    expect(validateDispatcherConfig(null, T2).ok).toBe(false);
    expect(validateDispatcherConfig("urn", T2).ok).toBe(false);
    expect(validateDispatcherConfig(42, T2).ok).toBe(false);
  });

  test("rejects missing or non-string `type`", () => {
    expect(validateDispatcherConfig({}, T2).ok).toBe(false);
    expect(validateDispatcherConfig({ type: "" }, T2).ok).toBe(false);
  });

  test("rejects unknown `type`", () => {
    const r = validateDispatcherConfig({ type: "nope" }, T2);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].path).toBe("type");
  });

  describe("uniform-random", () => {
    test("accepts the bare `type` form", () => {
      const r = validateDispatcherConfig({ type: "uniform-random" }, T3);
      expect(r.ok).toBe(true);
      expect(r.diagnostics).toEqual([]);
    });

    test("rejects stray fields (would mislead the author)", () => {
      const r = validateDispatcherConfig(
        { type: "uniform-random", counts: { t0: 1, t1: 2, t2: 3 } },
        T3,
      );
      expect(r.ok).toBe(false);
      expect(r.diagnostics[0].path).toBe("counts");
    });
  });

  describe("weighted-random", () => {
    test("accepts a well-formed labeled weights object", () => {
      const r = validateDispatcherConfig(
        { type: "weighted-random", weights: { t0: 4, t1: 1, t2: 1 } },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("accepts float weights", () => {
      const r = validateDispatcherConfig(
        { type: "weighted-random", weights: { t0: 0.8, t1: 0.1, t2: 0.1 } },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("rejects positional-array form (removed in 0.14)", () => {
      const r = validateDispatcherConfig(
        { type: "weighted-random", weights: [4, 1, 1] },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(
        /map keyed by treatment name|removed in stagebook 0\.14/,
      );
    });

    test("rejects unresolved file references on `weights`", () => {
      const r = validateDispatcherConfig(
        { type: "weighted-random", weights: { from: "./weights.json" } },
        T3,
      );
      expect(r.ok).toBe(false);
      expect(r.diagnostics[0].path).toBe("weights");
    });

    test("flags missing labels", () => {
      const r = validateDispatcherConfig(
        { type: "weighted-random", weights: { t0: 4 } },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/missing.*t1.*t2|t1.*t2/);
    });

    test("flags extra labels", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-random",
          weights: { t0: 1, t1: 1, t2: 1, tX: 1 },
        },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/unknown.*tX/);
    });

    test("rejects negative / NaN / non-finite entries", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-random",
          weights: { t0: 1, t1: -1, t2: Number.NaN, t3: Infinity },
        },
        ["t0", "t1", "t2", "t3"],
      );
      expect(r.ok).toBe(false);
      const paths = r.diagnostics.map((d) => d.path).sort();
      expect(paths).toContain("weights.t1");
      expect(paths).toContain("weights.t2");
      expect(paths).toContain("weights.t3");
    });

    test("zero entries are allowed (deactivate a treatment)", () => {
      const r = validateDispatcherConfig(
        { type: "weighted-random", weights: { t0: 4, t1: 0, t2: 1 } },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("all-zero weights warn but don't fail validation (gated-off batch)", () => {
      const r = validateDispatcherConfig(
        { type: "weighted-random", weights: { t0: 0, t1: 0, t2: 0 } },
        T3,
      );
      expect(r.ok).toBe(true);
      const warnings = r.diagnostics.filter((d) => d.severity === "warning");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toMatch(/all zero|no assignments/i);
    });
  });

  describe("urn", () => {
    test("accepts a well-formed labeled counts object", () => {
      const r = validateDispatcherConfig(
        { type: "urn", counts: { t0: 2, t1: 2, t2: 2 } },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("rejects positional-array form (removed in 0.14)", () => {
      const r = validateDispatcherConfig(
        { type: "urn", counts: [2, 2, 2] },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(
        /map keyed by treatment name|removed in stagebook 0\.14/,
      );
    });

    test("rejects unresolved file references on `counts`", () => {
      const r = validateDispatcherConfig(
        { type: "urn", counts: { from: "./counts.json" } },
        T3,
      );
      expect(r.ok).toBe(false);
      expect(r.diagnostics[0].path).toBe("counts");
    });

    test("flags missing labels", () => {
      const r = validateDispatcherConfig(
        { type: "urn", counts: { t0: 1 } },
        T2,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/missing.*t1/);
    });

    test("flags extra labels", () => {
      const r = validateDispatcherConfig(
        { type: "urn", counts: { t0: 1, t1: 2, tX: 3 } },
        T2,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/unknown.*tX/);
    });

    test("rejects non-integer / negative count entries", () => {
      const r = validateDispatcherConfig(
        { type: "urn", counts: { t0: 2, t1: -1, t2: 1.5 } },
        T3,
      );
      expect(r.ok).toBe(false);
      const paths = r.diagnostics.map((d) => d.path).sort();
      expect(paths).toContain("counts.t1");
      expect(paths).toContain("counts.t2");
    });

    test("accepts a well-formed labeled identity-decrement matrix", () => {
      const r = validateDispatcherConfig(
        {
          type: "urn",
          counts: { t0: 4, t1: 4, t2: 4 },
          decrements: {
            t0: { t0: 1 },
            t1: { t1: 1 },
            t2: { t2: 1 },
          },
        },
        T3,
      );
      expect(r.ok).toBe(true);
      // Negative assertion: a correctly-self-decrementing config must
      // produce zero warnings. Catches spurious-warning regressions in
      // the zero-self-decrement check (e.g. an off-by-one that fires
      // on `selfVal === 1`).
      expect(
        r.diagnostics.filter((d) => d.severity === "warning"),
      ).toHaveLength(0);
    });

    test("requires a row for every treatment when `decrements` is specified", () => {
      // No layered-on-identity mode — if you specify `decrements`,
      // you specify it fully. Authors who want identity behavior for
      // some treatments must write the diagonal explicitly.
      const r = validateDispatcherConfig(
        {
          type: "urn",
          counts: { t0: 4, t1: 4, t2: 4 },
          decrements: {
            t0: { t0: 1, t1: 1 }, // cross-couple t0 → t1
            // t1 and t2 rows missing → error
          },
        },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/missing a row.*t1.*t2|t1.*t2/);
    });

    test("accepts a fully-specified decrements with cross-coupling and explicit diagonals", () => {
      const r = validateDispatcherConfig(
        {
          type: "urn",
          counts: { t0: 4, t1: 4, t2: 4 },
          decrements: {
            t0: { t0: 1, t1: 1 }, // cross-couple t0 → t1
            t1: { t1: 1 }, // explicit identity
            t2: { t2: 1 }, // explicit identity
          },
        },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("warns when a treatment with counts > 0 has zero self-decrement", () => {
      // t1's row exists but has no t1→t1 entry; t1 will never deplete
      // from its own picks. Surface as a warning (might be intentional
      // for cross-coupled-only designs, but more often a typo).
      const r = validateDispatcherConfig(
        {
          type: "urn",
          counts: { t0: 4, t1: 4 },
          decrements: {
            t0: { t0: 1, t1: 1 },
            t1: { t0: 1 }, // missing t1→t1
          },
        },
        T2,
      );
      // ok is still true because zero-self-decrement is a warning,
      // not an error — the user might want this.
      expect(r.ok).toBe(true);
      const warnings = r.diagnostics.filter((d) => d.severity === "warning");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toMatch(/t1.*not decremented|never deplete/i);
    });

    test("rejects positional-matrix form (removed in 0.14)", () => {
      const r = validateDispatcherConfig(
        {
          type: "urn",
          counts: { t0: 2, t1: 2, t2: 2 },
          decrements: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
        },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(
        /map keyed by treatment name|removed in stagebook 0\.14/,
      );
    });

    test("flags unknown row labels in decrements", () => {
      const r = validateDispatcherConfig(
        {
          type: "urn",
          counts: { t0: 4, t1: 4 },
          decrements: {
            t0: { t0: 1 },
            t1: { t1: 1 },
            tX: { tX: 1 }, // unknown row
          },
        },
        T2,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/unknown.*tX|tX/);
    });

    test("flags unknown column labels in decrements", () => {
      const r = validateDispatcherConfig(
        {
          type: "urn",
          counts: { t0: 4, t1: 4 },
          decrements: {
            t0: { t0: 1, tX: 1 }, // unknown column
            t1: { t1: 1 },
          },
        },
        T2,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/tX.*does not match/);
    });

    test("rejects decrement[i][j] > counts[j] (would underflow on first use)", () => {
      const r = validateDispatcherConfig(
        {
          type: "urn",
          counts: { t0: 1, t1: 1 },
          decrements: {
            t0: { t0: 1, t1: 2 },
            t1: { t1: 1 },
          },
        },
        T2,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/underflow|exceeds counts/);
    });
  });

  describe("weighted-knockdown", () => {
    test('accepts "equal" payoffs + "none" knockdowns (simplest valid config)', () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: "none",
        },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("accepts labeled-scalars payoffs + scalar knockdown", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: { t0: 1.5, t1: 0.8, t2: 2 },
          knockdowns: 0.5,
        },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("accepts labeled-scalars knockdowns (per-treatment self-decay)", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: { t0: 0.5, t1: 0.7, t2: 0.9 },
        },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("accepts labeled-matrix knockdowns (cross-treatment decay)", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: {
            t0: { t0: 0.5, t1: 0.9, t2: 1 },
            t1: { t0: 0.9, t1: 0.5, t2: 1 },
            t2: { t2: 0.5 }, // missing columns default to 1
          },
        },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("accepts optional temperature", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: "none",
          temperature: 1,
        },
        T3,
      );
      expect(r.ok).toBe(true);
    });

    test("rejects positional-array payoffs (would mislead — no positional form supported)", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: [1, 2, 3],
          knockdowns: "none",
        },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/map keyed by treatment name/);
    });

    test("rejects unresolved file references", () => {
      const a = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: { from: "./p.json" },
          knockdowns: "none",
        },
        T3,
      );
      expect(a.ok).toBe(false);
      const b = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: { from: "./k.json" },
        },
        T3,
      );
      expect(b.ok).toBe(false);
    });

    test("rejects payoffs with mismatched labels", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: { t0: 1 }, // missing t1, t2
          knockdowns: "none",
        },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/missing/);
    });

    test("rejects scalar knockdown outside [0, 1]", () => {
      const a = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: 1.5,
        },
        T3,
      );
      expect(a.ok).toBe(false);
      const b = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: -0.1,
        },
        T3,
      );
      expect(b.ok).toBe(false);
    });

    test("rejects labeled-matrix with missing rows (strict-literal rule)", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: {
            t0: { t0: 0.5, t1: 0.9, t2: 1 },
            // t1 and t2 rows missing
          },
        },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/missing a row/);
    });

    test("rejects unknown row labels in labeled-matrix", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: {
            t0: { t0: 0.5 },
            t1: { t1: 0.5 },
            t2: { t2: 0.5 },
            tX: { tX: 0.5 },
          },
        },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/unknown.*tX/);
    });

    test("rejects unknown column labels in labeled-matrix", () => {
      const r = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: {
            t0: { t0: 0.5, tX: 0.5 },
            t1: { t1: 0.5 },
            t2: { t2: 0.5 },
          },
        },
        T3,
      );
      expect(r.ok).toBe(false);
      const messages = r.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/tX.*does not match/);
    });

    test("rejects negative / non-finite temperature", () => {
      const a = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: "none",
          temperature: -1,
        },
        T3,
      );
      expect(a.ok).toBe(false);
      const b = validateDispatcherConfig(
        {
          type: "weighted-knockdown",
          payoffs: "equal",
          knockdowns: "none",
          temperature: Infinity,
        },
        T3,
      );
      expect(b.ok).toBe(false);
    });
  });
});
