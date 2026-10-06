import { describe, expect, test, vi } from "vitest";
import {
  evaluateExpression,
  Missing,
  type ExpressionReference,
} from "./evaluateExpression.js";

const ref = (name = "answer", position = "self") => ({
  reference: `${position}.prompt.${name}.value`,
});
const leaf = (comparator: string, value?: unknown, position = "self") => ({
  ...ref("answer", position),
  comparator,
  ...(value === undefined ? {} : { value }),
});
const evaluate = (expression: unknown, answer?: unknown) =>
  evaluateExpression(expression, { readReference: () => answer });

describe("expression values and missingness", () => {
  test.each([0, false, "", "null", "undefined", "missing", "self.prompt.x"])(
    "preserves literal %j without interpreting strings as references",
    (value) => expect(evaluate(value)).toBe(value),
  );
  test.each([null, undefined, NaN, Infinity, -Infinity])(
    "%j is Missing",
    (value) => expect(evaluate(value)).toBe(Missing),
  );
  test("preserves literal list positions and does not mutate inputs", () => {
    const values = Object.freeze(["red", null, 0, false]);
    expect(evaluate({ literal: values })).toEqual(["red", Missing, 0, false]);
    expect(values).toEqual(["red", null, 0, false]);
  });
  test("leaves source-specific blank normalization to readReference (#757)", () => {
    expect(evaluate(ref(), "")).toBe("");
    expect(evaluate(ref(), [])).toEqual([]);
    expect(evaluate({ reference: "self.prompt.answer.entry" }, "")).toBe("");
    expect(evaluate({ reference: "self.attributes.label" }, "")).toBe("");
    expect(evaluate({ literal: ["", null] })).toEqual(["", Missing]);
  });
  test("preserves a whole record read for presence checks", () => {
    const reference = {
      position: "self",
      source: "prompt",
      name: "answer",
      path: [],
    };
    expect(
      evaluate({ reference, comparator: "exists" }, { isValid: true }),
    ).toBe(true);
  });
  test("passes the original author reference descriptor to the resolver", () => {
    const reference = {
      position: "self",
      source: "prompt",
      name: "answer",
      path: ["value"],
    };
    const readReference = vi.fn(() => 7);
    expect(evaluateExpression({ reference }, { readReference })).toBe(7);
    expect(readReference).toHaveBeenCalledWith(reference);
  });
  test("preserves group seats, including missing answers and list answers", () => {
    expect(
      evaluate(ref("answer", "everyone"), [
        undefined,
        Missing,
        ["a", "b"],
        0,
        Missing,
      ]),
    ).toEqual([Missing, Missing, ["a", "b"], 0, Missing]);
  });
  test("normalizes sparse resolver arrays to explicit Missing seats", () => {
    const seats: unknown[] = new Array(3);
    seats[1] = "yes";
    const onViolation = vi.fn();
    expect(
      evaluateExpression(ref("answer", "everyone"), {
        readReference: () => seats,
        onViolation,
      }),
    ).toEqual([Missing, "yes", Missing]);
    expect(onViolation).not.toHaveBeenCalled();
  });
});

describe("operator vocabulary", () => {
  test.each([
    [{ all: [true, true] }, true],
    [{ all: [true, null] }, false],
    [{ any: [false, null] }, false],
    [{ none: [false, null] }, true],
    [{ none: false }, true],
    [{ allEqual: ["Blue", " blue "] }, true],
    [{ allEqual: [null, null] }, false],
    [{ allEqual: ["100", "100.00"] }, false],
    [
      {
        allEqual: [
          { literal: ["red", "Blue"] },
          { literal: [" Red ", "blue"] },
        ],
      },
      true,
    ],
    [
      { allEqual: [{ literal: ["red", null] }, { literal: ["red", null] }] },
      false,
    ],
    [{ allEqual: [{ literal: [] }, { literal: [] }] }, true],
    [{ allUnique: ["red", "blue", "green"] }, true],
    [{ allUnique: ["red", " RED "] }, false],
    [{ allUnique: ["red", null] }, false],
    [{ strictlyIncreasing: [0, 5, 10] }, true],
    [{ nonDecreasing: [1, 1, 2] }, true],
    [{ strictlyDecreasing: [9, 6, 2] }, true],
    [{ nonIncreasing: [9, 9, 2] }, true],
    [{ strictlyIncreasing: [0, null, 10] }, false],
    [
      {
        includes: {
          container: " Research methods ",
          members: ["research", "METHODS"],
        },
      },
      true,
    ],
    [
      {
        includes: { container: { literal: ["red", null] }, members: [" RED "] },
      },
      true,
    ],
    [
      {
        includes: { container: { literal: ["red", null] }, members: ["blue"] },
      },
      false,
    ],
    [{ includes: { container: "red", members: [null] } }, false],
    [
      { matches: { string: "AB123", patterns: ["^[A-Z]{2}[0-9]{3}$", "^AB"] } },
      true,
    ],
    [
      {
        matches: {
          string: "ab123",
          patterns: ["^[A-Z]{2}[0-9]{3}$"],
          flags: "i",
        },
      },
      true,
    ],
    [{ matches: { string: " AB123 ", patterns: ["^AB123$"] } }, false],
    [{ sum: [2, -1, 4] }, 5],
    [{ sum: 4 }, 4],
    [{ average: [2, 4, 6] }, 4],
    [{ product: [2, 3, 4] }, 24],
    [{ product: [0, null] }, Missing],
    [{ min: [12, 9, 15] }, 9],
    [{ max: [12, 9, 15] }, 15],
    [{ subtract: { from: 10, value: 3 } }, 7],
    [{ divide: { numerator: 7, denominator: 2 } }, 3.5],
    [
      { divide: { numerator: 7, denominator: { countTrue: [false] } } },
      Missing,
    ],
    [{ sum: [Number.MAX_VALUE, Number.MAX_VALUE] }, Missing],
    [{ length: "🙂" }, 2],
    [{ length: " A " }, 3],
    [{ length: { literal: ["red", null] } }, 2],
    [{ length: { literal: [] } }, 0],
    [{ length: null }, Missing],
    [{ sumExisting: [2, null, 4] }, 6],
    [{ averageExisting: { inputs: [6, null, 2], atLeast: 2 } }, 4],
    [{ averageExisting: { inputs: [6, null, null], atLeast: 2 } }, Missing],
    [{ minExisting: [3, null, 5] }, 3],
    [{ maxExisting: [3, null, 5] }, 5],
    [{ firstExisting: [null, 0, 4] }, 0],
    [{ firstExisting: [null, false, true] }, false],
    [{ firstExisting: [null, "", "fallback"] }, ""],
    [{ firstExisting: [null, { literal: [] }, { literal: ["x"] }] }, []],
    [{ countExisting: [0, false, "", null] }, 3],
    [{ countTrue: [true, false, null] }, 1],
    [{ countUnique: ["red", " Red ", "blue", null] }, 2],
    [
      {
        case: {
          rules: [
            { when: null, value: "first" },
            { when: true, value: "second" },
            { default: true, value: "last" },
          ],
        },
      },
      "second",
    ],
    [
      {
        case: {
          rules: [
            { when: true, value: null },
            { default: true, value: "last" },
          ],
        },
      },
      Missing,
    ],
  ])("evaluates %j", (expression, expected) => {
    expect(evaluate(expression)).toEqual(expected);
  });

  test.each([
    "all",
    "any",
    "none",
    "sum",
    "average",
    "product",
    "min",
    "max",
    "allEqual",
    "allUnique",
    "strictlyIncreasing",
    "nonDecreasing",
    "strictlyDecreasing",
    "nonIncreasing",
  ])("%s returns Missing for an empty runtime list", (operator) =>
    expect(evaluate({ [operator]: ref() }, [])).toBe(Missing),
  );
  test.each([
    "allEqual",
    "allUnique",
    "strictlyIncreasing",
    "nonDecreasing",
    "strictlyDecreasing",
    "nonIncreasing",
  ])("%s requires at least two runtime operands", (operator) =>
    expect(evaluate({ [operator]: ref() }, [1])).toBe(Missing),
  );
  test.each(["countExisting", "countTrue", "countUnique"])(
    "%s returns 0 on empty or absent runtime inputs",
    (operator) => {
      expect(evaluate({ [operator]: { literal: [] } })).toBe(0);
      expect(evaluate({ [operator]: ref() })).toBe(0);
    },
  );
  test("no implicit flattening within an authored operand list", () => {
    expect(evaluate({ sum: [ref(), 1] }, [2, 3])).toBe(Missing);
  });
});

describe("comparator leaves", () => {
  test.each([
    ["exists", undefined, undefined, false],
    ["doesNotExist", undefined, undefined, true],
    ["equals", "Yes", " yes ", true],
    ["doesNotEqual", "Yes", undefined, true],
    ["isAbove", 4, 5, true],
    ["isBelow", 4, 3, true],
    ["isAtLeast", 4, 4, true],
    ["isAtMost", 4, 4, true],
    ["hasLengthAtLeast", 2, "🙂", true],
    ["hasLengthAtMost", 2, ["a", "b"], true],
    ["includes", "a", ["A", "b"], true],
    ["doesNotInclude", "a", undefined, true],
    ["matches", "/^a.b$/is", "A\nb", true],
    ["doesNotMatch", "^x$", undefined, true],
    ["isOneOf", ["a", "b"], " B ", true],
    ["isNotOneOf", ["a", "b"], undefined, true],
  ] as const)(
    "%s follows the operator semantics",
    (comparator, value, answer, expected) => {
      expect(evaluate(leaf(comparator, value), answer)).toBe(expected);
    },
  );
  test.each([
    "equals",
    "isAbove",
    "isBelow",
    "isAtLeast",
    "isAtMost",
    "hasLengthAtLeast",
    "hasLengthAtMost",
    "includes",
    "matches",
    "isOneOf",
  ])("%s cannot match a missing answer", (comparator) => {
    const value =
      comparator === "isOneOf"
        ? ["x"]
        : comparator === "matches" ||
            comparator === "includes" ||
            comparator === "equals"
          ? "x"
          : 1;
    expect(evaluate(leaf(comparator, value))).toBe(false);
  });
  test("group leaves compare each seat, including list answers", () => {
    expect(
      evaluate(leaf("includes", "red", "everyone"), [
        ["red", "blue"],
        undefined,
        [" RED "],
      ]),
    ).toEqual([true, false, true]);
    expect(
      evaluate({ countTrue: leaf("includes", "red", "everyone") }, [
        ["red"],
        undefined,
        ["red"],
      ]),
    ).toBe(2);
  });
});

describe("runtime contracts and evaluation order", () => {
  test("reports type names, never participant values, and deduplicates references", () => {
    const onViolation = vi.fn();
    const expression = { sumExisting: [ref(), ref(), 4] };
    expect(
      evaluateExpression(expression, {
        readReference: () => "private answer",
        onViolation,
      }),
    ).toBe(4);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({
      kind: "typeMismatch",
      reference: "self.prompt.answer.value",
      expected: "number",
      actual: "string",
    });
  });
  test("supports deduplication across repeated evaluations", () => {
    const onViolation = vi.fn();
    const options = {
      readReference: () => "private answer",
      onViolation,
      violationKeys: new Set<string>(),
    };
    evaluateExpression({ sum: ref() }, options);
    evaluateExpression({ sum: ref() }, options);
    expect(onViolation).toHaveBeenCalledTimes(1);
  });
  test.each([
    { firstExisting: [ref(), 0] },
    { sum: [{ firstExisting: [ref(), 0] }] },
    {
      sum: [
        { firstExisting: [ref(), { reference: "self.prompt.fallback.value" }] },
      ],
    },
    { case: { rules: [{ when: true, value: { firstExisting: [ref(), 0] } }] } },
  ])(
    "wrong reference types become Missing before choosing a fallback in %j",
    (expression) => {
      const onViolation = vi.fn();
      expect(
        evaluateExpression(expression, {
          readReference: (reference) =>
            reference === "self.prompt.fallback.value" ? 0 : "wrong",
          onViolation,
        }),
      ).toBe(0);
      expect(onViolation).toHaveBeenCalledTimes(1);
    },
  );
  test("comparison literals constrain fallbacks without resolving unreachable references", () => {
    const readReference = vi.fn((reference: ExpressionReference) =>
      reference === "self.prompt.fallback.value" ? 2 : "wrong",
    );
    const expression = {
      allEqual: [
        { firstExisting: [ref(), { reference: "self.prompt.fallback.value" }] },
        2,
      ],
    };
    expect(evaluateExpression(expression, { readReference })).toBe(true);
    expect(readReference.mock.calls.map(([reference]) => reference)).toEqual([
      "self.prompt.answer.value",
      "self.prompt.fallback.value",
    ]);
  });
  test.each([
    {
      includes: {
        container: "abc",
        members: [
          {
            firstExisting: [ref(), { reference: "self.prompt.fallback.value" }],
          },
        ],
      },
    },
    {
      includes: {
        container: {
          firstExisting: [ref(), { reference: "self.prompt.fallback.value" }],
        },
        members: ["b"],
      },
    },
    {
      countUnique: [
        { firstExisting: [ref(), { reference: "self.prompt.fallback.value" }] },
        "c",
      ],
    },
  ])(
    "membership and unique counts constrain branch types in %j",
    (expression) => {
      const onViolation = vi.fn();
      const result = evaluateExpression(expression, {
        readReference: (reference) =>
          reference === "self.prompt.fallback.value" ? "b" : 42,
        onViolation,
      });
      expect(result).toBe("countUnique" in expression ? 2 : true);
      expect(onViolation).toHaveBeenCalledTimes(1);
    },
  );
  test.each([NaN, Infinity, 1n, () => true, Symbol("private")])(
    "reports an unsupported reference value without exposing it",
    (value) => {
      const onViolation = vi.fn();
      expect(
        evaluateExpression(ref(), { readReference: () => value, onViolation }),
      ).toBe(Missing);
      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation.mock.calls[0][0]).toEqual({
        kind: "typeMismatch",
        reference: "self.prompt.answer.value",
        expected: typeof value === "number" ? "finite number" : "value",
        actual: typeof value,
      });
    },
  );
  test.each([2, "true", [], {}])(
    "present non-Boolean %j has no truthiness",
    (value) => {
      const onViolation = vi.fn();
      expect(
        evaluateExpression(
          { all: [ref()] },
          { readReference: () => value, onViolation },
        ),
      ).toBe(false);
      if (!Array.isArray(value)) expect(onViolation).toHaveBeenCalledTimes(1);
    },
  );
  test("uses the literal type to detect runtime mismatches in both equality directions", () => {
    for (const inputs of [
      [ref(), 2],
      [2, ref()],
    ]) {
      const onViolation = vi.fn();
      expect(
        evaluateExpression(
          { allEqual: inputs },
          { readReference: () => "2", onViolation },
        ),
      ).toBe(false);
      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation).toHaveBeenCalledWith({
        kind: "typeMismatch",
        reference: "self.prompt.answer.value",
        expected: "number",
        actual: "string",
      });
    }
  });
  test("evaluates non-short-circuit operators fully, left to right", () => {
    const calls: ExpressionReference[] = [];
    const onViolation = vi.fn();
    evaluateExpression(
      { product: [ref("a"), ref("b"), ref("c")] },
      {
        readReference: (reference) => {
          calls.push(reference);
          return typeof reference === "string" && reference.includes(".a.")
            ? 0
            : "wrong";
        },
        onViolation,
      },
    );
    expect(calls).toEqual([
      "self.prompt.a.value",
      "self.prompt.b.value",
      "self.prompt.c.value",
    ]);
    expect(onViolation).toHaveBeenCalledTimes(2);
  });
  test.each([
    { all: [false, ref()] },
    { any: [true, ref()] },
    { none: [true, ref()] },
    { firstExisting: [0, ref()] },
    {
      case: {
        rules: [
          { when: true, value: 4 },
          { when: ref(), value: ref() },
        ],
      },
    },
  ])("does not readReference unreachable operands in %j", (expression) => {
    const readReference = vi.fn();
    evaluateExpression(expression, { readReference });
    expect(readReference).not.toHaveBeenCalled();
  });
  test("wrong values inside a group become Missing independently", () => {
    const onViolation = vi.fn();
    expect(
      evaluateExpression(
        { sumExisting: ref("answer", "everyone") },
        { readReference: () => [2, "wrong", 3], onViolation },
      ),
    ).toBe(5);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({
      kind: "typeMismatch",
      reference: "everyone.prompt.answer.value",
      expected: "number",
      actual: "string",
    });
  });
  test("host readiness errors propagate instead of becoming participant absence", () => {
    expect(() =>
      evaluateExpression(
        { none: { reference: "everyone.prompt.answer", comparator: "exists" } },
        {
          readReference: () => {
            throw new Error("roster not ready");
          },
        },
      ),
    ).toThrow("roster not ready");
  });
  test("violation callback exceptions never change evaluation", () => {
    expect(
      evaluateExpression(
        { sum: ref() },
        {
          readReference: () => "wrong",
          onViolation: () => {
            throw new Error("logging failed");
          },
        },
      ),
    ).toBe(Missing);
  });
  test.each([
    {},
    { sum: [2], any: [true] },
    { literal: {} },
    { sum: { unknown: true } },
    { reference: "no.position" },
    { reference: "all.prompt.x" },
    { reference: "self.prompt.x", comparator: "unknown" },
    { matches: { string: "a", patterns: ["("] } },
    { matches: { string: "a", patterns: ["a"], flags: "g" } },
  ])("malformed expression %j fails closed", (expression) =>
    expect(evaluate(expression)).toBe(Missing),
  );
  test("cyclic expression and reference values cannot recurse forever", () => {
    const cycle: { sum: unknown[] } = { sum: [] };
    cycle.sum.push(cycle);
    expect(evaluate(cycle)).toBe(Missing);
    const cyclicValue: unknown[] = [];
    cyclicValue.push(cyclicValue);
    expect(evaluate(ref(), cyclicValue)).toEqual([Missing]);
  });
});

describe("branch type inference review regressions", () => {
  test("a Boolean leaf fallback constrains a preceding reference", () => {
    const onViolation = vi.fn();
    expect(
      evaluateExpression(
        {
          firstExisting: [
            ref("a"),
            { reference: "self.prompt.b.value", comparator: "exists" },
          ],
        },
        { readReference: () => 123, onViolation },
      ),
    ).toBe(true);
    expect(onViolation).toHaveBeenCalledWith({
      kind: "typeMismatch",
      reference: "self.prompt.a.value",
      expected: "boolean",
      actual: "number",
    });
  });
  test("a Boolean leaf case branch constrains the selected result", () => {
    const onViolation = vi.fn();
    expect(
      evaluateExpression(
        {
          case: {
            rules: [
              { when: true, value: ref("a") },
              {
                default: true,
                value: {
                  reference: "self.prompt.b.value",
                  comparator: "exists",
                },
              },
            ],
          },
        },
        { readReference: () => 123, onViolation },
      ),
    ).toBe(Missing);
    expect(onViolation).toHaveBeenCalledTimes(1);
  });
  test("shared branch aliases have bounded syntax inference work", () => {
    let reads = 0;
    let expression: unknown = ref();
    for (let depth = 0; depth < 12; depth++) {
      const children = [expression, expression];
      expression = Object.defineProperty({}, "firstExisting", {
        enumerable: true,
        get: () => {
          reads++;
          return children;
        },
      });
    }
    expect(evaluateExpression(expression, { readReference: () => 1 })).toBe(1);
    expect(reads).toBeLessThan(1000);
  });
});

describe("reference normalization resource bounds", () => {
  test("normalizes shared array aliases once without expanding their graph", () => {
    let reads = 0;
    let value: unknown[] = ["answer"];
    for (let depth = 0; depth < 12; depth++) {
      const child = value;
      value = [child, child];
      Object.defineProperty(value, 0, {
        get: () => {
          reads++;
          return child;
        },
      });
    }
    const result = evaluateExpression(ref(), { readReference: () => value });
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) expect(result[0]).toBe(result[1]);
    expect(reads).toBeLessThan(100);
  });
});
