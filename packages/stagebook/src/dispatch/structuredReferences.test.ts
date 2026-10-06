import { describe, expect, test } from "vitest";
import { referenceSchema } from "../schemas/reference.js";
import { resolvedTreatmentSchema } from "../schemas/resolved.js";
import { extractConditionKeys } from "./extractConditionKeys.js";
import { makeEligibilityTable } from "./makeEligibilityTable.js";
import type { DispatchCondition, Treatment } from "./types.js";

function treatment(reference: DispatchCondition["reference"]): Treatment {
  return {
    name: "roles",
    playerCount: 1,
    groupComposition: [
      { position: 0, conditions: { reference, comparator: "exists" } },
    ],
  };
}

describe("structured dispatch references (#690)", () => {
  test("accepts a complete resolved treatment without adapting its references", () => {
    const parsed = resolvedTreatmentSchema.parse({
      name: "url-assignment",
      playerCount: 1,
      compatibleIntroSequences: [],
      groupComposition: [
        {
          position: 0,
          conditions: {
            reference: "self.entryUrl.params.condition",
            comparator: "equals",
            value: "treatment",
          },
        },
      ],
      gameStages: [
        { name: "task", duration: 60, elements: [{ type: "submitButton" }] },
      ],
    });
    const treatments: Treatment[] = [parsed];
    expect(extractConditionKeys(treatments)).toEqual(new Set(["entryUrl"]));
    const table = makeEligibilityTable({
      playerIds: ["p"],
      treatments,
      playerData: { p: { entryUrl: { params: { condition: "treatment" } } } },
    });
    expect(table.isEligible("p", 0, 0)).toBe(true);
  });

  test.each([
    "doesNotExist",
    "doesNotEqual",
    "doesNotInclude",
    "doesNotMatch",
    "isNotOneOf",
  ])("preserves %s on missing data in both reference forms", (comparator) => {
    const dotted = "self.prompt.role";
    for (const reference of [dotted, referenceSchema.parse(dotted)]) {
      const treatments: Treatment[] = [
        {
          name: "roles",
          playerCount: 2,
          groupComposition: [
            {
              position: 0,
              conditions: {
                reference,
                comparator,
                ...(comparator === "doesNotExist"
                  ? {}
                  : { value: comparator === "isNotOneOf" ? ["a"] : "a" }),
              },
            },
            {
              position: 1,
              conditions: {
                none: [{ reference, comparator: "equals", value: "a" }],
              },
            },
          ],
        },
      ];
      const table = makeEligibilityTable({
        playerIds: ["p"],
        treatments,
        playerData: {},
      });
      expect(table.isEligible("p", 0, 0)).toBe(true);
      // Negation now decides on Missing: no unanswered value equals a.
      expect(table.isEligible("p", 0, 1)).toBe(true);
    }
  });

  test.each([
    ["self.prompt.role", "prompt_role", { value: "moderator" }],
    ["self.prompt.role.isValid", "prompt_role", { isValid: true }],
    [
      "self.entryUrl.params.condition",
      "entryUrl",
      { params: { condition: "a" } },
    ],
    ["self.attributes.locale", "attributes", { locale: "en" }],
  ])("fetches and evaluates schema-normalized %s", (dotted, key, record) => {
    const parsed = referenceSchema.parse(dotted);
    const treatments = [treatment(parsed)];
    expect(extractConditionKeys(treatments)).toEqual(new Set([key]));
    const table = makeEligibilityTable({
      playerIds: ["answered", "missing"],
      treatments,
      playerData: { answered: { [key]: record } },
    });
    expect(table.isEligible("answered", 0, 0)).toBe(true);
    expect(table.isEligible("missing", 0, 0)).toBe(false);
  });

  test("preserves an explicit empty path instead of reading the prompt value", () => {
    const treatments = [
      treatment({ position: "self", source: "prompt", name: "role", path: [] }),
    ];
    const table = makeEligibilityTable({
      playerIds: ["answered", "missing"],
      treatments,
      playerData: { answered: { prompt_role: { isValid: true } } },
    });
    expect(table.isEligible("answered", 0, 0)).toBe(true);
    expect(table.isEligible("missing", 0, 0)).toBe(false);
  });

  test("collects mixed forms throughout nested operators and deduplicates keys", () => {
    const treatments: Treatment[] = [
      {
        name: "roles",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: {
              all: [
                {
                  reference: "self.prompt.role",
                  comparator: "equals",
                  value: "moderator",
                },
                {
                  any: [
                    {
                      reference: {
                        position: "self",
                        source: "prompt",
                        name: "role",
                      },
                      comparator: "equals",
                      value: "moderator",
                    },
                  ],
                },
                {
                  none: [
                    {
                      reference: {
                        position: "self",
                        source: "attributes",
                        path: ["blocked"],
                      },
                      comparator: "equals",
                      value: true,
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ];
    expect(extractConditionKeys(treatments)).toEqual(
      new Set(["prompt_role", "attributes"]),
    );
    const table = makeEligibilityTable({
      playerIds: ["eligible", "blocked", "wrong-role"],
      treatments,
      playerData: {
        eligible: {
          prompt_role: { value: "moderator" },
          attributes: { blocked: false },
        },
        blocked: {
          prompt_role: { value: "moderator" },
          attributes: { blocked: true },
        },
        "wrong-role": {
          prompt_role: { value: "participant" },
          attributes: { blocked: false },
        },
      },
    });
    expect(table.isEligible("eligible", 0, 0)).toBe(true);
    expect(table.isEligible("blocked", 0, 0)).toBe(false);
    expect(table.isEligible("wrong-role", 0, 0)).toBe(false);
  });

  test.each([0, "shared", "everyone"] as const)(
    "ignores structured %s positions",
    (position) => {
      const treatments = [
        treatment({ position, source: "prompt", name: "role" }),
      ];
      expect(extractConditionKeys(treatments)).toEqual(new Set());
      const table = makeEligibilityTable({
        playerIds: ["p"],
        treatments,
        playerData: { p: { prompt_role: { value: "moderator" } } },
      });
      expect(table.isEligible("p", 0, 0)).toBe(false);
    },
  );

  test.each([
    null,
    42,
    {},
    { position: "self", source: "prompt" },
    { position: "self", source: "attributes" },
    { position: "self", source: "prompt", name: "role", path: "value" },
    { position: "self", source: "unknown", name: "role" },
  ])("skips malformed references without throwing: %j", (reference) => {
    // Hosts may bypass schema validation; the dispatch tick must stay usable.
    const treatments = [treatment(reference as DispatchCondition["reference"])];
    expect(extractConditionKeys(treatments)).toEqual(new Set());
    const table = makeEligibilityTable({
      playerIds: ["p"],
      treatments,
      playerData: {},
    });
    expect(table.isEligible("p", 0, 0)).toBe(false);
  });
});
