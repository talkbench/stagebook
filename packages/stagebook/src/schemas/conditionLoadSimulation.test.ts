import { describe, expect, test } from "vitest";
import { conditionIsAlwaysFalseAtLoad } from "./conditionLoadSimulation.js";

const current = { reference: "shared.prompt.current.value" };
const group = { reference: "everyone.prompt.current.value" };
const prior = { reference: "shared.prompt.prior.value" };
const external = { reference: "shared.attributes.isKnownVpn" };
const exists = { ...current, comparator: "exists" };
const absent = { ...current, comparator: "doesNotExist" };
const context = { currentKeys: new Set(["prompt_current"]), playerCount: 3 };

describe("current-stage load simulation", () => {
  test.each([
    ["current exists", exists, true],
    ["current doesNotExist", absent, false],
    ["implicit all", [exists], true],
    ["none around current exists", { none: [exists] }, false],
    ["none around current absence", { none: [absent] }, true],
    [
      "any of current comparisons",
      { any: [exists, { ...current, comparator: "equals", value: "Yes" }] },
      true,
    ],
    ["nested any under all", { all: [{ any: [exists] }] }, true],
    [
      "numeric calculation",
      { nonIncreasing: [{ sum: [current, 3] }, 0] },
      true,
    ],
    [
      "zero still needs its missing factor",
      { allEqual: [{ product: [0, current] }, 0] },
      true,
    ],
    [
      "countExisting is zero at load",
      { allEqual: [{ countExisting: [current] }, 0] },
      false,
    ],
    [
      "countExisting threshold",
      { nonDecreasing: [1, { countExisting: [current] }] },
      true,
    ],
    [
      "Existing reduction with explicit zero fallback",
      { allEqual: [{ firstExisting: [{ sumExisting: [current] }, 0] }, 0] },
      false,
    ],
    [
      "case selects true default",
      {
        case: {
          rules: [
            { when: exists, value: false },
            { default: true, value: true },
          ],
        },
      },
      false,
    ],
    [
      "case selects null without falling through",
      {
        case: {
          rules: [
            { when: absent, value: null },
            { default: true, value: true },
          ],
        },
      },
      true,
    ],
    [
      "case without a matching rule",
      { case: { rules: [{ when: exists, value: true }] } },
      true,
    ],
    ["everyone exists", { all: { ...group, comparator: "exists" } }, true],
    ["anyone exists", { any: { ...group, comparator: "exists" } }, true],
    ["no seat answered", { none: { ...group, comparator: "exists" } }, false],
    [
      "every seat absent",
      { all: { ...group, comparator: "doesNotExist" } },
      false,
    ],
    [
      "countTrue preserves all seats",
      { nonDecreasing: [1, { countTrue: { ...group, comparator: "exists" } }] },
      true,
    ],
    [
      "group length equals known roster",
      { allEqual: [{ length: group }, 3] },
      false,
    ],
    [
      "group length differs from known roster",
      { allEqual: [{ length: group }, 2] },
      true,
    ],
    [
      "numeric seat reference",
      { reference: "1.prompt.current.value", comparator: "exists" },
      true,
    ],
    [
      "structured reference",
      {
        reference: {
          position: "shared",
          source: "prompt",
          name: "current",
          path: ["value"],
        },
        comparator: "exists",
      },
      true,
    ],
  ])("%s", (_name, condition, expected) => {
    expect(conditionIsAlwaysFalseAtLoad(condition, context)).toBe(expected);
  });
});

describe("unknown previous and external values", () => {
  test.each([
    ["any sibling can admit the stage", { any: [external, exists] }, false],
    [
      "all needs the unanswered current value",
      { all: [external, exists] },
      true,
    ],
    [
      "none contains a currently true absence check",
      { none: [external, absent] },
      true,
    ],
    ["none can still be true", { none: [external, exists] }, false],
    [
      "prior comparison can admit stage",
      { any: [{ ...prior, comparator: "equals", value: "Yes" }, exists] },
      false,
    ],
    [
      "calculation involving prior values is unproven",
      { allEqual: [{ firstExisting: [current, prior] }, 0] },
      false,
    ],
    [
      "case with unknown condition is unproven",
      {
        case: {
          rules: [
            { when: external, value: absent },
            { default: true, value: false },
          ],
        },
      },
      false,
    ],
    [
      "Boolean proof survives unknown nested arithmetic",
      { all: [{ nonIncreasing: [{ sum: [prior] }, 0] }, exists] },
      true,
    ],
    [
      "single unknown Boolean subtree can be negated",
      { none: { all: [external, exists] } },
      false,
    ],
    [
      "nested negations are evaluated compositionally",
      { none: { any: [{ none: [exists] }, external] } },
      true,
    ],
  ])("%s", (_name, condition, expected) => {
    expect(conditionIsAlwaysFalseAtLoad(condition, context)).toBe(expected);
  });
  test("having no current reference belongs to other lints", () => {
    expect(conditionIsAlwaysFalseAtLoad(false, context)).toBe(false);
    expect(
      conditionIsAlwaysFalseAtLoad({ ...prior, comparator: "exists" }, context),
    ).toBe(false);
  });
  test.each([undefined, -1, 0.5, 0, 1000000])(
    "unknown/invalid or oversized roster %s is never invented as zero",
    (playerCount) => {
      expect(
        conditionIsAlwaysFalseAtLoad(
          { any: { ...group, comparator: "exists" } },
          { ...context, playerCount },
        ),
      ).toBe(false);
    },
  );
  test("the missing roster does not prevent an independent Boolean proof", () => {
    expect(
      conditionIsAlwaysFalseAtLoad(
        { all: [{ any: { ...group, comparator: "exists" } }, exists] },
        { currentKeys: context.currentKeys },
      ),
    ).toBe(true);
  });
  test.each([
    undefined,
    [],
    null,
    { unknown: [exists] },
    { all: ["${gate}", exists] },
    { nonIncreasing: [{ sum: ["bad", current] }, 1] },
  ])(
    "invalid or unresolved syntax is left to schema validation: %j",
    (condition) => {
      expect(conditionIsAlwaysFalseAtLoad(condition, context)).toBe(false);
    },
  );
  test("regex evaluation is deliberately left unproven", () => {
    expect(
      conditionIsAlwaysFalseAtLoad(
        { all: [absent, { matches: { string: "No", patterns: ["^Yes$"] } }] },
        context,
      ),
    ).toBe(false);
  });
});
