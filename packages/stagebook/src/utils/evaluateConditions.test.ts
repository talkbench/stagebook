import { describe, test, expect } from "vitest";
import { evaluateCondition, evaluateConditions } from "./evaluateConditions.js";

// --------------- evaluateCondition ---------------

describe("evaluateCondition", () => {
  describe("default position (all)", () => {
    test("all values satisfy equals", () => {
      expect(
        evaluateCondition(
          { reference: "self.prompt.q1", comparator: "equals", value: "yes" },
          ["yes", "yes", "yes"],
        ),
      ).toBe(true);
    });

    test("fails if any value doesn't satisfy", () => {
      expect(
        evaluateCondition(
          { reference: "self.prompt.q1", comparator: "equals", value: "yes" },
          ["yes", "no", "yes"],
        ),
      ).toBe(false);
    });

    test("single value satisfies", () => {
      expect(
        evaluateCondition(
          { reference: "self.prompt.q1", comparator: "isAbove", value: 5 },
          [10],
        ),
      ).toBe(true);
    });

    test("empty values array fails for value comparators", () => {
      // Empty array means no data to compare against — the condition
      // cannot be satisfied. (Previously returned true via vacuous truth
      // of [].every(), which caused conditional submit buttons gated on
      // "exists" to appear before any prompt was answered.)
      expect(
        evaluateCondition(
          { reference: "self.prompt.q1", comparator: "equals", value: "yes" },
          [],
        ),
      ).toBe(false);
    });

    test("exists comparator", () => {
      expect(
        evaluateCondition(
          { reference: "self.prompt.q1", comparator: "exists" },
          ["some value"],
        ),
      ).toBe(true);
    });

    test("exists fails for undefined", () => {
      expect(
        evaluateCondition(
          { reference: "self.prompt.q1", comparator: "exists" },
          [undefined],
        ),
      ).toBe(false);
    });

    test("exists fails for empty array (nothing exists)", () => {
      expect(
        evaluateCondition(
          { reference: "self.prompt.q1", comparator: "exists" },
          [],
        ),
      ).toBe(false);
    });

    test("doesNotExist passes for empty array", () => {
      expect(
        evaluateCondition(
          { reference: "self.prompt.q1", comparator: "doesNotExist" },
          [],
        ),
      ).toBe(true);
    });
  });

  // After #238, `position` on a condition leaf is a pure read selector
  // — `"shared"`, `"player"` (default), or a numeric slot index.
  // Cross-player aggregation (`all`/`any`) lives in the boolean-tree
  // operators (#235); the numeric `percentAgreement` aggregator was
  // pulled out entirely (no migration). These tests pin that the leaf
  // evaluator no longer special-cases the dropped values: an `"any"` or
  // `"percentAgreement"` string passed in (e.g. by a host that bypasses
  // the schema) falls through to the default read-selector path, which
  // ANDs `compare(value, comparator, expected)` across the resolved
  // values rather than running the deprecated aggregation.
  describe("dropped position values fall through to default semantics", () => {
    test("'any' as a position string no longer fans out — every value must satisfy", () => {
      // Pre-#238: `position: any` was true if ANY value matched.
      // Post-#238: with two non-matching values and one matching, the
      // default read-selector AND-semantics rejects the leaf.
      expect(
        evaluateCondition(
          {
            reference: "all.prompt.q1",
            comparator: "equals",
            value: "yes",
          },
          ["no", "no", "yes"],
        ),
      ).toBe(false);
    });

    test("'percentAgreement' as a position string no longer aggregates — comparator runs against each raw value", () => {
      // Pre-#238: `position: percentAgreement` compared the consensus
      // percentage (here 80) against the threshold. Post-#238 the
      // comparator is applied to the raw values directly: "yes"
      // isAtLeast 80 is undefined (string vs number), so the leaf's
      // tri-state collapses to false at the public boundary.
      expect(
        evaluateCondition(
          {
            reference: "self.prompt.q1",
            comparator: "isAtLeast",
            value: 80,
          },
          ["yes", "yes", "yes", "yes", "no"],
        ),
      ).toBe(false);
    });
  });

  describe("comparator edge cases", () => {
    test("doesNotEqual with undefined lhs returns true", () => {
      expect(
        evaluateCondition(
          {
            reference: "self.prompt.q1",
            comparator: "doesNotEqual",
            value: "x",
          },
          [undefined],
        ),
      ).toBe(true);
    });

    test("string includes", () => {
      expect(
        evaluateCondition(
          {
            reference: "self.prompt.q1",
            comparator: "includes",
            value: "world",
          },
          ["hello world"],
        ),
      ).toBe(true);
    });

    test("isOneOf with array value", () => {
      expect(
        evaluateCondition(
          {
            reference: "self.prompt.q1",
            comparator: "isOneOf",
            value: ["a", "b", "c"],
          },
          ["b"],
        ),
      ).toBe(true);
    });
  });
});

// --------------- evaluateConditions ---------------

describe("evaluateConditions", () => {
  const mockResolve = (values: Record<string, unknown[]>) => {
    return (reference: string) => values[reference] ?? [];
  };

  test("empty conditions returns true", () => {
    expect(evaluateConditions([], mockResolve({}))).toBe(true);
  });

  test("single condition met", () => {
    expect(
      evaluateConditions(
        [{ reference: "self.prompt.q1", comparator: "equals", value: "yes" }],
        mockResolve({ "self.prompt.q1": ["yes"] }),
      ),
    ).toBe(true);
  });

  test("single condition not met", () => {
    expect(
      evaluateConditions(
        [{ reference: "self.prompt.q1", comparator: "equals", value: "yes" }],
        mockResolve({ "self.prompt.q1": ["no"] }),
      ),
    ).toBe(false);
  });

  test("multiple conditions: all must be true (AND logic)", () => {
    expect(
      evaluateConditions(
        [
          { reference: "self.prompt.q1", comparator: "equals", value: "yes" },
          { reference: "self.prompt.q2", comparator: "isAbove", value: 5 },
        ],
        mockResolve({ "self.prompt.q1": ["yes"], "self.prompt.q2": [10] }),
      ),
    ).toBe(true);
  });

  test("multiple conditions: fails if any is false", () => {
    expect(
      evaluateConditions(
        [
          { reference: "self.prompt.q1", comparator: "equals", value: "yes" },
          { reference: "self.prompt.q2", comparator: "isAbove", value: 5 },
        ],
        mockResolve({ "self.prompt.q1": ["yes"], "self.prompt.q2": [3] }),
      ),
    ).toBe(false);
  });

  test("condition with missing reference (empty array) fails", () => {
    // Missing references resolve to [] — the condition cannot be satisfied
    // without data. (Regression test: previously returned true via the
    // vacuous truth of [].every(), which caused conditional submit buttons
    // gated on "exists" to appear before any prompt was answered.)
    expect(
      evaluateConditions(
        [
          {
            reference: "self.prompt.missing",
            comparator: "equals",
            value: "yes",
          },
        ],
        mockResolve({}),
      ),
    ).toBe(false);
  });

  test("exists on missing reference fails", () => {
    expect(
      evaluateConditions(
        [{ reference: "self.prompt.missing", comparator: "exists" }],
        mockResolve({}),
      ),
    ).toBe(false);
  });

  test("doesNotExist on missing reference passes", () => {
    expect(
      evaluateConditions(
        [{ reference: "self.prompt.missing", comparator: "doesNotExist" }],
        mockResolve({}),
      ),
    ).toBe(true);
  });

  // ----- Positional comparators by name (issue #232, updated for #298) -----
  //
  // After #298, position is part of the reference string (`shared.X`,
  // `0.X`, `1.X`, `self.X`). Stagebook just forwards the reference to
  // the host's `resolve(reference)` callback; the host's resolver
  // parses out the position and looks up the right slot. These tests
  // pin the forwarding contract and confirm comparator semantics on
  // the resolved values.

  // A position-aware resolver: maps the full position-prefixed reference
  // to its values. Models a host that's parsed the prefix and routed to
  // the right scope.
  const resolveByReference = (table: Record<string, unknown[]>) => {
    return (reference: string) => table[reference] ?? [];
  };

  test("position: shared — forwards the reference and uses the resolved value", () => {
    const resolve = resolveByReference({
      "shared.prompt.flag": ["yes"],
      "0.prompt.flag": ["no"],
      "1.prompt.flag": ["maybe"],
    });
    expect(
      evaluateConditions(
        [
          {
            reference: "shared.prompt.flag",
            comparator: "equals",
            value: "yes",
          },
        ],
        resolve,
      ),
    ).toBe(true);
  });

  test("position: shared — failure case (shared value doesn't match)", () => {
    const resolve = resolveByReference({
      "shared.prompt.flag": ["no"],
      "0.prompt.flag": ["yes"],
    });
    expect(
      evaluateConditions(
        [
          {
            reference: "shared.prompt.flag",
            comparator: "equals",
            value: "yes",
          },
        ],
        resolve,
      ),
    ).toBe(false);
  });

  test("position: 0 — resolves to the position-0 player's value", () => {
    const resolve = resolveByReference({
      "0.prompt.q": ["red"],
      "1.prompt.q": ["blue"],
    });
    expect(
      evaluateConditions(
        [{ reference: "0.prompt.q", comparator: "equals", value: "red" }],
        resolve,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ reference: "0.prompt.q", comparator: "equals", value: "blue" }],
        resolve,
      ),
    ).toBe(false);
  });

  test("position: 1 — resolves to the position-1 player's value", () => {
    const resolve = resolveByReference({
      "0.prompt.q": ["red"],
      "1.prompt.q": ["blue"],
    });
    expect(
      evaluateConditions(
        [
          {
            reference: "1.prompt.q",
            comparator: "equals",
            value: "blue",
          },
        ],
        resolve,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [
          {
            reference: "1.prompt.q",
            comparator: "equals",
            value: "red",
          },
        ],
        resolve,
      ),
    ).toBe(false);
  });

  test("reference string is forwarded to resolver verbatim (spy)", () => {
    // After #298, the position is embedded in the reference. The
    // resolver takes only the reference; hosts parse out the position.
    // Verify with a spy that each leaf's reference reaches the resolver
    // unchanged.
    const calls: string[] = [];
    const resolve = (reference: string) => {
      calls.push(reference);
      return ["x"];
    };
    evaluateConditions(
      [
        { reference: "shared.prompt.q", comparator: "equals", value: "x" },
        { reference: "0.prompt.q", comparator: "equals", value: "x" },
        { reference: "self.prompt.q", comparator: "equals", value: "x" },
      ],
      resolve,
    );
    expect(calls).toEqual(["shared.prompt.q", "0.prompt.q", "self.prompt.q"]);
  });
});

// --------------- Boolean tree (#235) ---------------

describe("evaluateConditions — boolean tree (#235)", () => {
  // Resolver helper: looks up reference name in a fixture map; returns
  // an empty array for unknown references so the leaf evaluator's
  // "no data → undefined" path triggers.
  const makeResolve =
    (data: Record<string, unknown[]>) =>
    (reference: string): unknown[] =>
      data[reference] ?? [];

  describe("array form (implicit all)", () => {
    test("empty array returns true (no gate)", () => {
      expect(evaluateConditions([], makeResolve({}))).toBe(true);
    });

    test("single leaf in array", () => {
      const resolve = makeResolve({ "self.prompt.q": ["yes"] });
      expect(
        evaluateConditions(
          [{ reference: "self.prompt.q", comparator: "equals", value: "yes" }],
          resolve,
        ),
      ).toBe(true);
    });

    test("multiple leaves AND together", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["x"],
        "self.prompt.b": ["y"],
      });
      expect(
        evaluateConditions(
          [
            { reference: "self.prompt.a", comparator: "equals", value: "x" },
            { reference: "self.prompt.b", comparator: "equals", value: "y" },
          ],
          resolve,
        ),
      ).toBe(true);
    });

    test("any leaf failing makes the array false", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["x"],
        "self.prompt.b": ["wrong"],
      });
      expect(
        evaluateConditions(
          [
            { reference: "self.prompt.a", comparator: "equals", value: "x" },
            { reference: "self.prompt.b", comparator: "equals", value: "y" },
          ],
          resolve,
        ),
      ).toBe(false);
    });
  });

  describe("all operator", () => {
    test("all children true → true", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["x"],
        "self.prompt.b": ["y"],
      });
      expect(
        evaluateConditions(
          {
            all: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(true);
    });

    test("any child false → false", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["x"],
        "self.prompt.b": ["wrong"],
      });
      expect(
        evaluateConditions(
          {
            all: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });

    test("all data missing → undefined → false at boundary", () => {
      // No data resolved for either reference. Each leaf is undefined
      // (tri-state). `all` over [undefined, undefined] is undefined,
      // which collapses to false at the public boundary.
      const resolve = makeResolve({});
      expect(
        evaluateConditions(
          {
            all: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });
  });

  describe("any operator", () => {
    test("at least one child true → true", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["wrong"],
        "self.prompt.b": ["y"],
      });
      expect(
        evaluateConditions(
          {
            any: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(true);
    });

    test("all children false → false", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["wrong"],
        "self.prompt.b": ["wrong"],
      });
      expect(
        evaluateConditions(
          {
            any: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });

    test("all children unknown → undefined → false at boundary", () => {
      const resolve = makeResolve({});
      expect(
        evaluateConditions(
          {
            any: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });
  });

  describe("none operator (the case that requires tri-state)", () => {
    test("all children false → true", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["wrong"],
        "self.prompt.b": ["wrong"],
      });
      expect(
        evaluateConditions(
          {
            none: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(true);
    });

    test("any child true → false", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["x"],
        "self.prompt.b": ["wrong"],
      });
      expect(
        evaluateConditions(
          {
            none: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });

    test("all children unknown → undefined → false (tri-state guard)", () => {
      // This is the pivotal test: with two-valued logic, `none:` over
      // unknown leaves would return true (no children are explicitly
      // true), causing fallback elements to render before any
      // participant has answered. Tri-state semantics catch this — the
      // unknown propagates through `none` and collapses to false at the
      // boundary.
      const resolve = makeResolve({});
      expect(
        evaluateConditions(
          {
            none: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });

    test("one child known false, one unknown → undefined → false", () => {
      const resolve = makeResolve({ "self.prompt.a": ["wrong"] });
      expect(
        evaluateConditions(
          {
            none: [
              { reference: "self.prompt.a", comparator: "equals", value: "x" },
              { reference: "self.prompt.b", comparator: "equals", value: "y" },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });
  });

  describe("nested operator unknown propagation", () => {
    test("all containing none-of-unknowns → undefined → false at boundary", () => {
      // Outer `all` should see the inner `none: [unknown, unknown]` as
      // undefined (not true), so the overall result is undefined → false.
      // If the inner `none` had two-valued semantics, this would
      // incorrectly evaluate to true (no children true → none = true →
      // all = true).
      const resolve = makeResolve({});
      expect(
        evaluateConditions(
          {
            all: [
              {
                none: [
                  {
                    reference: "self.prompt.a",
                    comparator: "equals",
                    value: "x",
                  },
                ],
              },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });

    test("any containing all with one known-true and one unknown", () => {
      // Inner `all` has [true, unknown] → undefined. Outer `any` has
      // [undefined] → undefined → boundary false. The known-true child
      // inside the inner `all` does not "leak out" because the
      // surrounding `all` didn't reach a definitive answer.
      const resolve = makeResolve({ "self.prompt.a": ["x"] });
      expect(
        evaluateConditions(
          {
            any: [
              {
                all: [
                  {
                    reference: "self.prompt.a",
                    comparator: "equals",
                    value: "x",
                  },
                  {
                    reference: "self.prompt.b",
                    comparator: "equals",
                    value: "y",
                  },
                ],
              },
            ],
          },
          resolve,
        ),
      ).toBe(false);
    });
  });

  describe("nested operators", () => {
    test("(A or B) and C", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["wrong"],
        "self.prompt.b": ["yes"],
        "self.prompt.c": ["go"],
      });
      expect(
        evaluateConditions(
          {
            all: [
              {
                any: [
                  {
                    reference: "self.prompt.a",
                    comparator: "equals",
                    value: "yes",
                  },
                  {
                    reference: "self.prompt.b",
                    comparator: "equals",
                    value: "yes",
                  },
                ],
              },
              { reference: "self.prompt.c", comparator: "equals", value: "go" },
            ],
          },
          resolve,
        ),
      ).toBe(true);
    });

    test("array root with nested operator inside", () => {
      const resolve = makeResolve({
        "self.prompt.a": ["yes"],
        "self.prompt.b": ["no"],
        "self.prompt.c": ["yes"],
      });
      // Top-level array (implicit all): each item must hold.
      // Item 1: leaf "prompt.a == yes" → true
      // Item 2: any of (b == yes, c == yes) → c == yes → true
      // overall true.
      expect(
        evaluateConditions(
          [
            { reference: "self.prompt.a", comparator: "equals", value: "yes" },
            {
              any: [
                {
                  reference: "self.prompt.b",
                  comparator: "equals",
                  value: "yes",
                },
                {
                  reference: "self.prompt.c",
                  comparator: "equals",
                  value: "yes",
                },
              ],
            },
          ],
          resolve,
        ),
      ).toBe(true);
    });

    test("none containing nested all", () => {
      // `none` of [all(A,B), C] — true when neither (A and B) nor C
      // holds.
      const resolve = makeResolve({
        "self.prompt.a": ["yes"],
        "self.prompt.b": ["no"], // (a and b) is false
        "self.prompt.c": ["no"], // c is false
      });
      expect(
        evaluateConditions(
          {
            none: [
              {
                all: [
                  {
                    reference: "self.prompt.a",
                    comparator: "equals",
                    value: "yes",
                  },
                  {
                    reference: "self.prompt.b",
                    comparator: "equals",
                    value: "yes",
                  },
                ],
              },
              {
                reference: "self.prompt.c",
                comparator: "equals",
                value: "yes",
              },
            ],
          },
          resolve,
        ),
      ).toBe(true);
    });
  });

  describe("single leaf at root", () => {
    test("single leaf object (not in array) — true case", () => {
      const resolve = makeResolve({ "self.prompt.q": ["yes"] });
      expect(
        evaluateConditions(
          { reference: "self.prompt.q", comparator: "equals", value: "yes" },
          resolve,
        ),
      ).toBe(true);
    });

    test("single leaf object — false case", () => {
      const resolve = makeResolve({ "self.prompt.q": ["no"] });
      expect(
        evaluateConditions(
          { reference: "self.prompt.q", comparator: "equals", value: "yes" },
          resolve,
        ),
      ).toBe(false);
    });
  });
});

// --------------- Negative comparators vs unset reference (#348) ---------------
//
// Authors gate fallback prompts on negative comparators (`doesNotEqual "Yes"`)
// and expect the gate to fire when the upstream value is absent. Previously
// the empty-array short-circuit in `evaluateLeafTriState` returned `undefined`
// for every comparator except `doesNotExist`, never reaching `compare.ts`'s
// `doesNotEqual` special case. Now that path delegates to `compare(undefined,
// ...)`, picking up the four-negative absence-satisfaction policy.
//
// See the "undefined lhs" block in compare.test.ts for the per-comparator
// behavior; this block pins the composition cases that matter most to
// authors building fallback gates.

describe("evaluateConditions — negative comparators vs unset reference (#348)", () => {
  const emptyResolve = (_ref: string): unknown[] => [];

  test("doesNotEqual against [] is true (was undefined)", () => {
    expect(
      evaluateConditions(
        {
          reference: "self.prompt.q",
          comparator: "doesNotEqual",
          value: "Yes",
        },
        emptyResolve,
      ),
    ).toBe(true);
  });

  test("doesNotInclude against [] is true", () => {
    expect(
      evaluateConditions(
        {
          reference: "self.prompt.q",
          comparator: "doesNotInclude",
          value: "x",
        },
        emptyResolve,
      ),
    ).toBe(true);
  });

  test("doesNotMatch against [] is true", () => {
    expect(
      evaluateConditions(
        {
          reference: "self.prompt.q",
          comparator: "doesNotMatch",
          value: "/x/",
        },
        emptyResolve,
      ),
    ).toBe(true);
  });

  test("isNotOneOf against [] is true", () => {
    expect(
      evaluateConditions(
        {
          reference: "self.prompt.q",
          comparator: "isNotOneOf",
          value: ["a", "b"],
        },
        emptyResolve,
      ),
    ).toBe(true);
  });

  test("equals against [] stays undefined (collapsed to false at boundary)", () => {
    // Positive comparators remain undefined-on-absence so authors can
    // gate "render once data exists" without prematurely satisfying.
    expect(
      evaluateConditions(
        { reference: "self.prompt.q", comparator: "equals", value: "Yes" },
        emptyResolve,
      ),
    ).toBe(false);
  });

  test("exists against [] is false (was undefined-collapsed-to-false at boundary)", () => {
    // Outer behavior unchanged in the common case; the difference matters
    // for `none: [exists ...]` composition (see below).
    expect(
      evaluateConditions(
        { reference: "self.prompt.q", comparator: "exists" },
        emptyResolve,
      ),
    ).toBe(false);
  });

  test("any: [doesNotEqual, doesNotEqual] with both refs absent fires (was no-render)", () => {
    // The dialogue-levers/pilot_3 repro case: a fallback gated on either
    // player not having said "Yes". Was returning false-at-boundary;
    // now correctly renders.
    expect(
      evaluateConditions(
        {
          any: [
            {
              reference: "0.prompt.continue_with_partner",
              comparator: "doesNotEqual",
              value: "Yes",
            },
            {
              reference: "1.prompt.continue_with_partner",
              comparator: "doesNotEqual",
              value: "Yes",
            },
          ],
        },
        emptyResolve,
      ),
    ).toBe(true);
  });

  test("none: [equals against []] stays undefined-collapsed-to-false (unchanged)", () => {
    // Positive comparator inside `none:` — leaf is `undefined`, none-of-
    // undefined is undefined per Kleene, boundary collapses to false.
    expect(
      evaluateConditions(
        {
          none: [
            { reference: "self.prompt.q", comparator: "equals", value: "Yes" },
          ],
        },
        emptyResolve,
      ),
    ).toBe(false);
  });

  test("none: [exists against []] is true (intentional semantic shift)", () => {
    // Previously: `none: [undefined]` → `undefined` → `false` at boundary.
    // Now: `compare(undefined, "exists")` returns `false` directly →
    // `none: [false]` → `true`. Arguably the more correct semantic ("none
    // of these exist" is true when none do); pinned here so a future
    // refactor doesn't silently revert it.
    expect(
      evaluateConditions(
        {
          none: [{ reference: "self.prompt.q", comparator: "exists" }],
        },
        emptyResolve,
      ),
    ).toBe(true);
  });

  test("none: [doesNotEqual against []] is false (new definite-false)", () => {
    // After the fix, `doesNotEqual X` against `[]` is `true` (definite),
    // so `none: [true]` is `false` (definite). Logically equivalent to
    // `equals X` against `[]` which stays undefined-collapsed-to-false;
    // the boundary results match but the internal definite-ness differs.
    expect(
      evaluateConditions(
        {
          none: [
            {
              reference: "self.prompt.q",
              comparator: "doesNotEqual",
              value: "Yes",
            },
          ],
        },
        emptyResolve,
      ),
    ).toBe(false);
  });
});
