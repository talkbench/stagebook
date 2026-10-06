import { describe, test, expect, vi } from "vitest";
import { makeEligibilityTable } from "./makeEligibilityTable.js";
import type { Treatment } from "./types.js";

describe("makeEligibilityTable", () => {
  test("evaluates arithmetic and a structured reference through the shared reader", () => {
    const treatments: Treatment[] = [
      {
        name: "scored",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: {
              nonDecreasing: [
                10,
                {
                  sum: [
                    {
                      reference: {
                        position: "self",
                        source: "prompt",
                        name: "a",
                        path: ["value"],
                      },
                    },
                    { reference: "self.prompt.b.value" },
                  ],
                },
              ],
            },
          },
        ],
      },
    ];
    const table = makeEligibilityTable({
      playerIds: ["yes", "no", "blank"],
      treatments,
      playerData: {
        yes: { prompt_a: { value: 6 }, prompt_b: { value: 4 } },
        no: { prompt_a: { value: 3 }, prompt_b: { value: 4 } },
        blank: { prompt_a: { value: " " }, prompt_b: { value: 4 } },
      },
    });
    expect(table.isEligible("yes", 0, 0)).toBe(true);
    expect(table.isEligible("no", 0, 0)).toBe(false);
    expect(table.isEligible("blank", 0, 0)).toBe(false);
  });

  test.each(["", " \t\n", []].map((value) => ({ value })))(
    "blank prompt answers do not establish presence",
    ({ value }) => {
      const treatments: Treatment[] = [
        {
          name: "answered",
          playerCount: 2,
          groupComposition: [
            {
              position: 0,
              conditions: {
                reference: "self.prompt.answer",
                comparator: "exists",
              },
            },
            {
              position: 1,
              conditions: {
                reference: "self.prompt.answer",
                comparator: "doesNotEqual",
                value: "yes",
              },
            },
          ],
        },
      ];
      const table = makeEligibilityTable({
        playerIds: ["p"],
        treatments,
        playerData: { p: { prompt_answer: { value, isValid: true } } },
      });
      expect(table.isEligible("p", 0, 0)).toBe(false);
      expect(table.isEligible("p", 0, 1)).toBe(true);
    },
  );

  test("strict numbers and negative comparisons share normal Missing behavior", () => {
    const treatments: Treatment[] = [
      {
        name: "numeric",
        playerCount: 3,
        groupComposition: [
          {
            position: 0,
            conditions: {
              reference: "self.prompt.score.value",
              comparator: "isAtLeast",
              value: 4,
            },
          },
          {
            position: 1,
            conditions: {
              reference: "self.prompt.score.value",
              comparator: "doesNotEqual",
              value: 4,
            },
          },
          {
            position: 2,
            conditions: {
              none: [
                {
                  reference: "self.prompt.score.value",
                  comparator: "isBelow",
                  value: 4,
                },
              ],
            },
          },
        ],
      },
    ];
    const onViolation = vi.fn();
    const table = makeEligibilityTable({
      playerIds: ["text", "number", "missing"],
      treatments,
      playerData: {
        text: { prompt_score: { value: "4" } },
        number: { prompt_score: { value: 4 } },
      },
      onViolation,
    });
    expect(
      [0, 1, 2].map((position) => table.isEligible("text", 0, position)),
    ).toEqual([false, true, true]);
    expect(
      [0, 1, 2].map((position) => table.isEligible("number", 0, position)),
    ).toEqual([true, false, true]);
    expect(
      [0, 1, 2].map((position) => table.isEligible("missing", 0, position)),
    ).toEqual([false, true, true]);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({
      kind: "typeMismatch",
      reference: "self.prompt.score.value",
      expected: "number",
      actual: "string",
    });
  });

  test("deduplicates sanitized violations across candidates, slots, treatments and retained ticks", () => {
    const conditions = {
      nonDecreasing: [
        0,
        { firstExisting: [{ reference: "self.prompt.score.value" }, 0] },
      ],
    };
    const treatments: Treatment[] = [0, 1].map((index) => ({
      name: `t${index}`,
      playerCount: 2,
      groupComposition: [0, 1].map((position) => ({ position, conditions })),
    }));
    const onViolation = vi.fn();
    const args = {
      playerIds: ["p0", "p1"],
      treatments,
      playerData: {
        p0: { prompt_score: { value: "private p0" } },
        p1: { prompt_score: { value: "private p1" } },
      },
      onViolation,
      violationKeys: new Set<string>(),
    };
    for (let tick = 0; tick < 2; tick++) {
      const table = makeEligibilityTable(args);
      expect(table.isEligible("p0", 0, 0)).toBe(true);
      expect(table.isEligible("p1", 1, 1)).toBe(true);
    }
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({
      kind: "typeMismatch",
      reference: "self.prompt.score.value",
      expected: "number",
      actual: "string",
    });
    expect(JSON.stringify(onViolation.mock.calls)).not.toContain("private");
  });

  test("literal truth is allowed, while null and non-Boolean roots fail the gate", () => {
    const treatments: Treatment[] = [
      {
        name: "roots",
        playerCount: 4,
        groupComposition: [true, false, null, "true"].map(
          (conditions, position) => ({ position, conditions }),
        ),
      },
    ];
    const table = makeEligibilityTable({
      playerIds: ["p"],
      treatments,
      playerData: {},
    });
    expect(
      [0, 1, 2, 3].map((position) => table.isEligible("p", 0, position)),
    ).toEqual([true, false, false, false]);
  });

  test.each(["0.prompt.role", "shared.prompt.role"])(
    "nonself %s remains Missing even for a negative comparison",
    (reference) => {
      const treatments: Treatment[] = [
        {
          name: "candidate",
          playerCount: 1,
          groupComposition: [
            {
              position: 0,
              conditions: {
                reference,
                comparator: "doesNotEqual",
                value: "reject",
              },
            },
          ],
        },
      ];
      const table = makeEligibilityTable({
        playerIds: ["p"],
        treatments,
        playerData: { p: { prompt_role: { value: "reject" } } },
      });
      expect(table.isEligible("p", 0, 0)).toBe(true);
    },
  );

  test("treatments without groupComposition: every player eligible for every slot", () => {
    const treatments: Treatment[] = [
      { name: "t0", playerCount: 2 },
      { name: "t1", playerCount: 3 },
    ];
    const table = makeEligibilityTable({
      playerIds: ["p0", "p1"],
      treatments,
      playerData: {},
    });
    expect(table.isEligible("p0", 0, 0)).toBe(true);
    expect(table.isEligible("p0", 0, 1)).toBe(true);
    expect(table.isEligible("p1", 1, 2)).toBe(true);
  });

  test("slot without conditions: unconstrained", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 2,
        groupComposition: [{ position: 0 }, { position: 1 }],
      },
    ];
    const table = makeEligibilityTable({
      playerIds: ["p0"],
      treatments,
      playerData: {},
    });
    expect(table.isEligible("p0", 0, 0)).toBe(true);
    expect(table.isEligible("p0", 0, 1)).toBe(true);
  });

  test("evaluates `self.prompt.X` equality conditions per candidate", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 2,
        groupComposition: [
          {
            position: 0,
            conditions: [
              {
                reference: "self.prompt.role",
                comparator: "equals",
                value: "moderator",
              },
            ],
          },
          {
            position: 1,
            conditions: [
              {
                reference: "self.prompt.role",
                comparator: "equals",
                value: "participant",
              },
            ],
          },
        ],
      },
    ];
    const table = makeEligibilityTable({
      playerIds: ["mod", "part"],
      treatments,
      playerData: {
        mod: { prompt_role: { value: "moderator" } },
        part: { prompt_role: { value: "participant" } },
      },
    });
    expect(table.isEligible("mod", 0, 0)).toBe(true);
    expect(table.isEligible("mod", 0, 1)).toBe(false);
    expect(table.isEligible("part", 0, 0)).toBe(false);
    expect(table.isEligible("part", 0, 1)).toBe(true);
  });

  test("unknown player returns false (defensive lookup)", () => {
    const treatments: Treatment[] = [{ name: "t0", playerCount: 1 }];
    const table = makeEligibilityTable({
      playerIds: ["p0"],
      treatments,
      playerData: {},
    });
    expect(table.isEligible("never-seen", 0, 0)).toBe(false);
  });

  test("missing storage-key data → positive comparator fails, negative passes", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 2,
        groupComposition: [
          {
            position: 0,
            conditions: [
              {
                reference: "self.prompt.role",
                comparator: "equals",
                value: "x",
              },
            ],
          },
          {
            position: 1,
            conditions: [
              {
                reference: "self.prompt.role",
                comparator: "doesNotEqual",
                value: "x",
              },
            ],
          },
        ],
      },
    ];
    const table = makeEligibilityTable({
      playerIds: ["p0"],
      treatments,
      playerData: { p0: {} },
    });
    // No data → `equals` collapses to false at the boundary.
    expect(table.isEligible("p0", 0, 0)).toBe(false);
    // No data → `doesNotEqual` is satisfied by absence (#348).
    expect(table.isEligible("p0", 0, 1)).toBe(true);
  });

  test("non-self references read as Missing (no group composition yet)", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: [
              {
                // Numeric / shared / everyone selectors can't resolve from the
                // candidate alone — they'd need the eventual group.
                reference: "0.prompt.role",
                comparator: "equals",
                value: "anything",
              },
            ],
          },
        ],
      },
    ];
    const table = makeEligibilityTable({
      playerIds: ["p0"],
      treatments,
      playerData: { p0: { prompt_role: { value: "anything" } } },
    });
    expect(table.isEligible("p0", 0, 0)).toBe(false);
  });

  test("operator-tree conditions (any/none) evaluate correctly", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: {
              any: [
                {
                  reference: "self.prompt.role",
                  comparator: "equals",
                  value: "a",
                },
                {
                  reference: "self.prompt.role",
                  comparator: "equals",
                  value: "b",
                },
              ],
            },
          },
        ],
      },
    ];
    const table = makeEligibilityTable({
      playerIds: ["pa", "pb", "pc"],
      treatments,
      playerData: {
        pa: { prompt_role: { value: "a" } },
        pb: { prompt_role: { value: "b" } },
        pc: { prompt_role: { value: "c" } },
      },
    });
    expect(table.isEligible("pa", 0, 0)).toBe(true);
    expect(table.isEligible("pb", 0, 0)).toBe(true);
    expect(table.isEligible("pc", 0, 0)).toBe(false);
  });

  test("external-source reference (`self.entryUrl.params.X`)", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: [
              {
                reference: "self.entryUrl.params.condition",
                comparator: "equals",
                value: "treatment",
              },
            ],
          },
        ],
      },
    ];
    const table = makeEligibilityTable({
      playerIds: ["p0", "p1"],
      treatments,
      playerData: {
        p0: { entryUrl: { params: { condition: "treatment" } } },
        p1: { entryUrl: { params: { condition: "control" } } },
      },
    });
    expect(table.isEligible("p0", 0, 0)).toBe(true);
    expect(table.isEligible("p1", 0, 0)).toBe(false);
  });
});
