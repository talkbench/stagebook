import { describe, expect, test, vi } from "vitest";
import { evaluateCondition, evaluateConditions } from "./evaluateConditions.js";
import { Missing } from "../expressions/missing.js";
import { readReference } from "./readReference.js";

const leaf = (comparator = "equals", value: unknown = "yes") => ({
  reference: "self.prompt.answer",
  comparator,
  ...(comparator === "exists" || comparator === "doesNotExist"
    ? {}
    : { value }),
});
const options = (value: unknown) => ({ readReference: () => value });

describe("condition boundary uses the expression evaluator", () => {
  test("omitted conditions are unconstrained without reading state", () => {
    const read = vi.fn();
    expect(evaluateConditions(undefined, { readReference: read })).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });
  test.each([null, false, 1, "true", [], { literal: [true] }])(
    "only true satisfies an authored root %j",
    (conditions) => {
      expect(evaluateConditions(conditions, options(Missing))).toBe(false);
    },
  );
  test("accepts one leaf, an explicit operator, and implicit all", () => {
    for (const conditions of [
      leaf(),
      { all: [leaf(), leaf("exists")] },
      [leaf(), leaf("exists")],
    ]) {
      expect(evaluateConditions(conditions, options(" YES "))).toBe(true);
      expect(evaluateConditions(conditions, options("no"))).toBe(false);
    }
  });
  test.each([Missing, null, undefined])(
    "positive claims fail and negations succeed against %s",
    (value) => {
      expect(evaluateConditions(leaf(), options(value))).toBe(false);
      expect(evaluateConditions(leaf("doesNotEqual"), options(value))).toBe(
        true,
      );
      expect(evaluateConditions({ none: leaf() }, options(value))).toBe(true);
      expect(
        evaluateConditions(
          { all: [leaf("exists"), { none: leaf() }] },
          options(value),
        ),
      ).toBe(false);
    },
  );
  test("new calculations and counts work at condition sites", () => {
    expect(
      evaluateConditions(
        {
          nonDecreasing: [5, { sum: [{ reference: "self.prompt.answer" }, 2] }],
        },
        options(3),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        {
          allEqual: [
            2,
            {
              countTrue: {
                reference: "everyone.prompt.answer",
                comparator: "exists",
              },
            },
          ],
        },
        options([1, Missing, 2]),
      ),
    ).toBe(true);
  });
  test("group leaves require explicit quantification and retain missing seats", () => {
    const group = {
      reference: "everyone.prompt.answer",
      comparator: "equals",
      value: "yes",
    };
    expect(evaluateConditions(group, options(["yes", "yes"]))).toBe(false);
    expect(evaluateConditions({ all: group }, options(["yes", Missing]))).toBe(
      false,
    );
    expect(evaluateConditions({ any: group }, options(["yes", Missing]))).toBe(
      true,
    );
    expect(evaluateConditions({ all: group }, options(["yes", "yes"]))).toBe(
      true,
    );
  });
  test("short circuits without reading later references", () => {
    const read = vi.fn();
    expect(
      evaluateConditions({ all: [false, leaf()] }, { readReference: read }),
    ).toBe(false);
    expect(
      evaluateConditions({ any: [true, leaf()] }, { readReference: read }),
    ).toBe(true);
    expect(
      evaluateConditions({ none: [true, leaf()] }, { readReference: read }),
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  test("forwards sanitized violations and shares deduplication across calls", () => {
    const onViolation = vi.fn();
    const config = {
      ...options("private participant text"),
      onViolation,
      violationKeys: new Set<string>(),
    };
    expect(evaluateConditions(leaf("isAbove", 5), config)).toBe(false);
    expect(evaluateConditions(leaf("isAbove", 5), config)).toBe(false);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({
      kind: "typeMismatch",
      reference: "self.prompt.answer",
      expected: "number",
      actual: "string",
    });
  });
  test.each(["", "   ", []])(
    "readReference normalizes a blank prompt %j before conditions",
    (value) => {
      const config = {
        readReference: (reference: Parameters<typeof readReference>[0]) =>
          readReference(reference, () => [{ value }], {}),
      };
      expect(evaluateConditions(leaf("exists"), config)).toBe(false);
      expect(evaluateConditions(leaf("doesNotExist"), config)).toBe(true);
    },
  );
  test("single-leaf helper receives one value, preserving array answers", () => {
    expect(evaluateCondition(leaf(), " YES ")).toBe(true);
    expect(evaluateCondition(leaf("includes", "a"), ["A", "B"])).toBe(true);
    expect(evaluateCondition(leaf(), Missing)).toBe(false);
  });
});
