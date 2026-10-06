import { describe, expect, test } from "vitest";
import { z } from "zod";
import { EXPRESSION_OPERATOR_KEYS } from "../expressions/operators.js";
import {
  createExpressionSchemas,
  expressionSchema,
  resolvedExpressionSchema,
  expressionConditionsSchema,
  resolvedExpressionConditionsSchema,
} from "./expression.js";

const ref = { reference: "self.prompt.answer.value" };
const group = { reference: "everyone.prompt.answer.value" };
const groupLeaf = { ...group, comparator: "exists" };
const validOperators = {
  all: [true, null],
  any: groupLeaf,
  none: { reference: "self.prompt.answer", comparator: "equals", value: "yes" },
  allEqual: [{ literal: ["red", "blue"] }, ref],
  allUnique: group,
  strictlyIncreasing: [1, ref, 3],
  nonDecreasing: [1, 1],
  strictlyDecreasing: [3, 2],
  nonIncreasing: [3, 3],
  includes: { container: "Research methods", members: ["research"] },
  matches: { string: ref, patterns: ["^yes$"], flags: "i" },
  length: { literal: ["a", null] },
  countExisting: [0, false, "", null],
  countTrue: groupLeaf,
  countUnique: ["a", "b", null],
  sum: [1, ref],
  average: group,
  product: [0, null],
  min: 1,
  max: { literal: [] },
  sumExisting: [1, null],
  averageExisting: { inputs: [1, ref], atLeast: 2 },
  minExisting: group,
  maxExisting: { inputs: group, atLeast: 4 },
  subtract: { from: 8, value: ref },
  divide: { numerator: 7, denominator: { countExisting: [null] } },
  case: {
    rules: [
      { when: true, value: "yes" },
      { default: true, value: null },
    ],
  },
  firstExisting: [ref, { literal: [] }, { literal: ["fallback"] }],
};

describe("resolved expression vocabulary", () => {
  test("covers all operator metadata", () => {
    expect(Object.keys(validOperators).sort()).toEqual(
      [...EXPRESSION_OPERATOR_KEYS].sort(),
    );
  });
  test.each(Object.entries(validOperators))("accepts %s", (operator, value) => {
    expect(
      resolvedExpressionSchema.safeParse({ [operator]: value }).success,
    ).toBe(true);
  });
  test.each([
    null,
    0,
    false,
    "",
    "self.prompt.x",
    { literal: [] },
    { literal: [null, null] },
    ref,
    group,
  ])("accepts expression %j", (expression) => {
    expect(resolvedExpressionSchema.safeParse(expression).success).toBe(true);
  });
  test.each([
    ["exists", undefined],
    ["doesNotExist", undefined],
    ["equals", ["a", "b"]],
    ["doesNotEqual", false],
    ["isAbove", 3],
    ["isBelow", -1],
    ["isAtLeast", 0],
    ["isAtMost", 2.5],
    ["hasLengthAtLeast", 0],
    ["hasLengthAtMost", 20],
    ["includes", 4],
    ["doesNotInclude", true],
    ["matches", "/^yes$/i"],
    ["doesNotMatch", "^no$"],
    ["isOneOf", ["a", "b"]],
    ["isNotOneOf", [true, false]],
  ])("accepts %s leaf", (comparator, value) => {
    const expression = {
      ...ref,
      comparator,
      ...(value === undefined ? {} : { value }),
    };
    expect(resolvedExpressionSchema.safeParse(expression).success).toBe(true);
  });
});

describe("strict expression structure", () => {
  test.each([
    [{ subtract: { from: 1 } }, "subtract.value", "invalid_type"],
    [{ sum: [] }, "sum", "too_small"],
    [
      { matches: { string: "x", patterns: [4] } },
      "matches.patterns.0",
      "invalid_type",
    ],
    [
      { sumExisting: { inputs: [1], atLeast: 1.5 } },
      "sumExisting.atLeast",
      "invalid_type",
    ],
  ])(
    "structural errors retain native Zod codes and operand paths: %j",
    (input, path, code) => {
      const result = resolvedExpressionSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const flatten = (
          issues: typeof result.error.issues,
        ): typeof result.error.issues =>
          issues.flatMap((issue) =>
            issue.code === "invalid_union"
              ? issue.unionErrors.flatMap((error) => flatten(error.issues))
              : [issue],
          );
        expect(flatten(result.error.issues)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code,
              path: path
                .split(".")
                .map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
            }),
          ]),
        );
      }
    },
  );
  test.each([
    undefined,
    [],
    [true],
    {},
    { nope: [1] },
    { sum: [1], min: [2] },
    { literal: 1, sum: [2] },
    { ...ref, value: 3 },
    { sum: [1], extra: true },
    { literal: { answer: 1 } },
    { literal: [[1]] },
    { literal: [1, "1"] },
    { literal: Infinity },
    { literal: [NaN] },
    { sum: [undefined] },
    { all: [] },
    { sum: [] },
    { countTrue: [] },
    { firstExisting: [] },
    { firstExisting: ref },
    { length: ["a"] },
    { allEqual: [1] },
    { allEqual: null },
    { allUnique: 1 },
    { strictlyIncreasing: 1 },
    { subtract: { from: 1 } },
    { subtract: [1, 2] },
    { subtract: { from: 1, value: 2, extra: true } },
    { divide: { numerator: 1, denominator: 0 } },
    { divide: { numerator: 1, denominator: { literal: 0 } } },
    { includes: { container: "a", members: [] } },
    { includes: { container: "a", members: "a" } },
    { matches: { string: "a", patterns: [] } },
    { matches: { string: "a", patterns: [{ literal: "a" }] } },
    { matches: { string: "a", patterns: ["a"], flags: "g" } },
    { matches: { string: "a", patterns: ["a"], flags: "ii" } },
    { sumExisting: { inputs: [1], atLeast: 2 } },
    { sumExisting: { inputs: [1], atLeast: 0 } },
    { sumExisting: { inputs: [1], atLeast: 1.5 } },
    { sumExisting: { inputs: [1], missing: "skip" } },
    { sum: { inputs: [1], atLeast: 1 } },
    { case: { rules: [] } },
    { case: { rules: [{ value: 1 }] } },
    { case: { rules: [{ when: true, default: true, value: 1 }] } },
    { case: { rules: [{ default: false, value: 1 }] } },
    { case: { rules: [{ when: true }] } },
    {
      case: {
        rules: [
          { default: true, value: 1 },
          { when: true, value: 2 },
        ],
      },
    },
    {
      case: {
        rules: [
          { default: true, value: 1 },
          { default: true, value: 2 },
        ],
      },
    },
  ])("rejects %j", (expression) => {
    expect(resolvedExpressionSchema.safeParse(expression).success).toBe(false);
  });
});

describe("known operand types", () => {
  test.each([
    { sum: [2, "3"] },
    { sum: [true] },
    { sum: [{ literal: [2, 3] }] },
    { all: [true, 1] },
    { countTrue: ["yes"] },
    { allEqual: [2, "2"] },
    { allEqual: [1, ref, "1"] },
    { allEqual: [{ literal: [1] }, { literal: ["1"] }] },
    { allUnique: [{ literal: [1] }, { literal: [2] }] },
    { allEqual: [{ literal: [1] }, 1] },
    { countUnique: [1, "1"] },
    { includes: { container: "123", members: [1] } },
    { includes: { container: { literal: [1] }, members: ["1"] } },
    { includes: { container: 1, members: [1] } },
    { length: 1 },
    { matches: { string: 1, patterns: ["1"] } },
    { firstExisting: [null, ref, 1, "1"] },
    { firstExisting: [{ literal: [] }, 1] },
    {
      firstExisting: [
        { literal: [null] },
        { literal: [1] },
        { literal: ["a"] },
      ],
    },
    {
      case: {
        rules: [
          { when: true, value: ref },
          { when: false, value: 1 },
          { default: true, value: "1" },
        ],
      },
    },
    { case: { rules: [{ when: "true", value: 1 }] } },
  ])("rejects provable mismatch %j", (expression) => {
    expect(resolvedExpressionSchema.safeParse(expression).success).toBe(false);
  });
  test.each([
    { firstExisting: [null, ref, 1] },
    { firstExisting: [{ literal: [] }, { literal: [null] }, { literal: [1] }] },
    { allEqual: [null, null] },
    { countExisting: [0, false, "", null] },
    { allEqual: { literal: [] } },
    { average: { literal: [null, null] } },
  ])("preserves unknown/missing/empty list types %j", (expression) => {
    expect(resolvedExpressionSchema.safeParse(expression).success).toBe(true);
  });
});

describe("ADR F1 and A4", () => {
  test.each([
    { ...ref, comparator: "equals", value: null },
    { ...ref, comparator: "isOneOf", value: ["a", null] },
    { ...ref, comparator: "equals", value: ["a", null] },
    { ...ref, comparator: "isOneOf", value: ["a", 1] },
    { ...ref, comparator: "exists", value: true },
    { ...ref, comparator: "doesNotExist", value: null },
    { ...ref, comparator: "equals" },
    { ...ref, comparator: "isAbove", value: "3" },
    { ...ref, comparator: "hasLengthAtLeast", value: -1 },
    { ...ref, comparator: "includes", value: ["a"] },
    { ...ref, comparator: "isOneOf", value: [] },
    { ...ref, comparator: "unknown", value: true },
  ])("rejects invalid comparator contract %j", (expression) => {
    expect(expressionSchema.safeParse(expression).success).toBe(false);
  });
  test("F1 null comparison provides a presence-check hint", () => {
    const result = expressionSchema.safeParse({
      ...ref,
      comparator: "equals",
      value: null,
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("doesNotExist"),
        ),
      ).toBe(true);
  });
  test.each([
    groupLeaf,
    { any: [groupLeaf, { ...ref, comparator: "exists" }] },
    { case: { rules: [{ when: groupLeaf, value: 1 }] } },
    { length: groupLeaf },
  ])("F1 requires a direct group quantifier %j", (expression) => {
    const result = expressionSchema.safeParse(expression);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some((issue) => issue.message.includes("all")),
      ).toBe(true);
  });
  test.each(["all", "any", "none", "countTrue"])(
    "accepts direct %s group consumer",
    (operator) => {
      expect(
        expressionSchema.safeParse({ [operator]: groupLeaf }).success,
      ).toBe(true);
    },
  );
  test("A4 rejects known text versus number in both directions and keeps unknown gradual", () => {
    const textSchemas = createExpressionSchemas({
      mode: "resolved",
      referenceType: () => "string",
    });
    const numericSchemas = createExpressionSchemas({
      mode: "resolved",
      referenceType: () => "number",
    });
    expect(
      textSchemas.expressionSchema.safeParse({
        ...ref,
        comparator: "equals",
        value: 4,
      }).success,
    ).toBe(false);
    expect(
      numericSchemas.expressionSchema.safeParse({
        ...ref,
        comparator: "equals",
        value: "4",
      }).success,
    ).toBe(false);
    expect(
      textSchemas.expressionSchema.safeParse({
        ...ref,
        comparator: "equals",
        value: "4",
      }).success,
    ).toBe(true);
    expect(
      expressionSchema.safeParse({ ...ref, comparator: "equals", value: 4 })
        .success,
    ).toBe(true);
  });
});

describe("condition roots and references", () => {
  test.each([
    true,
    false,
    { all: [true, null] },
    [true, { ...ref, comparator: "exists" }],
    ref,
  ])("accepts Boolean or gradually typed root %j", (condition) => {
    expect(
      resolvedExpressionConditionsSchema.safeParse(condition).success,
    ).toBe(true);
  });
  test.each([null, [], 1, "yes", { literal: [true] }, group, [groupLeaf]])(
    "rejects non-Boolean or bare group root %j",
    (condition) => {
      expect(
        resolvedExpressionConditionsSchema.safeParse(condition).success,
      ).toBe(false);
    },
  );
  test.each([
    "all.prompt.answer.value",
    "prompt.answer",
    "self.unknown.answer",
    "self.prompt",
    "-1.prompt.answer",
    "01.prompt.answer",
    { position: "everyone", source: "prompt", name: "answer", extra: true },
    { position: "self", source: "entryUrl", path: ["host"] },
  ])("rejects invalid or legacy reference %j", (reference) => {
    expect(expressionSchema.safeParse({ reference }).success).toBe(false);
  });
  test("accepts structured everyone without changing its descriptor", () => {
    const expression = {
      reference: {
        position: "everyone",
        source: "prompt",
        name: "answer",
        path: ["value"],
      },
    };
    expect(expressionSchema.parse(expression)).toEqual(expression);
  });
  test("group leaves compare each list-valued answer, without exposing nested lists", () => {
    const schemas = createExpressionSchemas({
      mode: "resolved",
      referenceType: () => ({ list: { list: "string" } }),
    });
    expect(
      schemas.expressionSchema.safeParse({
        all: { ...group, comparator: "includes", value: "red" },
      }).success,
    ).toBe(true);
    expect(
      schemas.expressionSchema.safeParse({
        all: { ...group, comparator: "includes", value: 1 },
      }).success,
    ).toBe(false);
    expect(schemas.expressionSchema.safeParse({ length: group }).success).toBe(
      false,
    );
    expect(schemas.expressionSchema.safeParse(group).success).toBe(false);
  });
  test("typed group numeric inputs work without implicit flattening", () => {
    const schemas = createExpressionSchemas({
      mode: "resolved",
      referenceType: () => ({ list: "number" }),
    });
    expect(schemas.expressionSchema.safeParse({ sum: group }).success).toBe(
      true,
    );
    expect(schemas.expressionSchema.safeParse({ sum: [group] }).success).toBe(
      false,
    );
    expect(schemas.conditionsSchema.safeParse(group).success).toBe(false);
  });
});

describe("authoring versus resolved templates", () => {
  test.each([
    "${expression}",
    { template: "score", fields: { weight: 2 } },
    { sum: "${inputs}" },
    { sum: ["${number}", 1] },
    { all: ["${boolean}"] },
    { sumExisting: { inputs: "${items}", atLeast: "${minimum}" } },
    { ...ref, comparator: "isAbove", value: "${cutoff}" },
    { reference: "self.prompt.answer_${index}.value" },
    { reference: "${reference}" },
    { reference: "${baseReference}.value" },
    { reference: "${seat}.prompt.answer.value" },
    { reference: "self.${source}.answer.value" },
    { reference: { position: "self", source: "${source}", name: "answer" } },
    {
      reference: {
        position: "${seat}",
        source: "prompt",
        name: "item_${index}",
      },
    },
    { includes: { container: "${prefix} suffix", members: ["${member}"] } },
    { firstExisting: "${items}" },
    { case: { rules: "${rules}" } },
    {
      case: {
        rules: [
          { when: "${condition}", value: "${answer}" },
          { default: "${isDefault}", value: null },
        ],
      },
    },
    { literal: "${values}" },
    { literal: ["${value}"] },
  ])("defers templates only in authoring %j", (expression) => {
    expect(expressionSchema.safeParse(expression).success).toBe(true);
    expect(resolvedExpressionSchema.safeParse(expression).success).toBe(false);
  });
  test.each([
    { sum: ["${number} suffix"] },
    { all: ["prefix ${boolean}"] },
    { ...ref, comparator: "isAbove", value: "${cutoff} " },
    { sumExisting: { inputs: [1], atLeast: "${minimum} " } },
    { template: "score", fields: { invalid: { template: "nested" } } },
    { template: "score", extra: true },
  ])("rejects malformed template context %j", (expression) => {
    expect(expressionSchema.safeParse(expression).success).toBe(false);
  });
  test("condition whole-value placeholder is authoring-only", () => {
    expect(expressionConditionsSchema.safeParse("${gate}").success).toBe(true);
    expect(
      resolvedExpressionConditionsSchema.safeParse("${gate}").success,
    ).toBe(false);
  });
  test("strings resembling non-template syntax stay literal", () => {
    expect(resolvedExpressionSchema.safeParse("${form.id}").success).toBe(true);
  });
});

test("regex dialect validation is an injectable boundary", () => {
  const schemas = createExpressionSchemas({
    mode: "resolved",
    validateRegex: (pattern) =>
      pattern === "blocked" ? "unsupported pattern" : undefined,
  });
  expect(
    schemas.expressionSchema.safeParse({
      matches: { string: "x", patterns: ["blocked"] },
    }).success,
  ).toBe(false);
  expect(
    schemas.expressionSchema.safeParse({
      ...ref,
      comparator: "matches",
      value: "/blocked/i",
    }).success,
  ).toBe(false);
});

test("cyclic YAML aliases report a validation error", () => {
  const expression: { firstExisting: unknown[] } = { firstExisting: [] };
  expression.firstExisting.push(expression);
  expect(expressionSchema.safeParse(expression).success).toBe(false);
});

test("oversized primitive operand lists stop reading and emit one complexity issue", () => {
  let reads = 0;
  const operands = Array.from({ length: 100000 }, () => true);
  for (let index = 0; index < operands.length; index++) {
    Object.defineProperty(operands, index, {
      get: () => {
        reads++;
        return true;
      },
    });
  }
  const result = expressionSchema.safeParse({ all: operands });
  expect(result.success).toBe(false);
  expect(reads).toBeLessThanOrEqual(10000);
  if (!result.success) {
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0].message).toContain("complexity limit");
  }
});

test("cyclic aliases in template broadcast are rejected before delegated parsing", () => {
  const template = {
    template: "score",
    broadcast: {} as Record<string, unknown>,
  };
  template.broadcast.d0 = template;
  expect(expressionSchema.safeParse(template).success).toBe(false);
});

test("nested default rules parse their shared value once per level", () => {
  let reads = 0;
  const schema = createExpressionSchemas({
    mode: "authoring",
    templateSchema: z
      .object({ template: z.literal("score") })
      .strict()
      .superRefine(() => {
        reads++;
      }),
  }).expressionSchema;
  let expression: unknown = { template: "score" };
  for (let depth = 0; depth < 20; depth++) {
    expression = { case: { rules: [{ default: true, value: expression }] } };
  }
  expect(schema.safeParse(expression).success).toBe(true);
  expect(reads).toBe(1);
});

describe("native structural diagnostic resource limits", () => {
  test("wide invalid operand lists retain a bounded set of native issues", () => {
    const result = expressionSchema.safeParse({
      sum: Array.from({ length: 1000 }, () => ({ bad: 1 })),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.length).toBeLessThanOrEqual(65);
    expect(result.error.message.length).toBeLessThan(1000000);
    expect(
      result.error.issues.some(
        (issue) =>
          issue.code === "unrecognized_keys" &&
          issue.keys.includes("bad") &&
          issue.path[0] === "sum" &&
          typeof issue.path[1] === "number",
      ),
    ).toBe(true);
  });

  test.each(["case", "sum"])(
    "deep invalid %s expressions produce serializable native errors",
    (operator) => {
      let expression: unknown = { bad: 1 };
      const depth = operator === "case" ? 31 : 127;
      for (let index = 0; index < depth; index++)
        expression =
          operator === "case"
            ? { case: { rules: [{ default: true, value: expression }] } }
            : { sum: expression };
      const result = expressionSchema.safeParse(expression);
      expect(result.success).toBe(false);
      if (result.success) return;
      // Assert the bounded representation first: a regression must not ask the
      // test reporter to stringify the original exponentially large tree.
      expect(
        result.error.issues.every(
          (issue) =>
            issue.code !== "invalid_union" || issue.unionErrors.length === 0,
        ),
      ).toBe(true);
      expect(result.error.issues.length).toBeLessThanOrEqual(65);
      expect(result.error.message.length).toBeLessThan(1000000);
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys" &&
            issue.keys.includes("bad") &&
            issue.path.length === (operator === "case" ? 124 : 127),
        ),
      ).toBe(true);
      try {
        expressionSchema.parse(expression);
        expect.unreachable("invalid expressions must throw a ZodError");
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError);
        expect((error as z.ZodError).message.length).toBeLessThan(1000000);
      }
    },
  );
});

describe("all properties visible to Zod are guarded", () => {
  test("rejects an inherited expression cycle", () => {
    const expression = {};
    Object.setPrototypeOf(expression, { sum: expression });
    expect(expressionSchema.safeParse(expression).success).toBe(false);
  });

  test("rejects a nonenumerable options cycle", () => {
    const expression = { sumExisting: {} };
    Object.defineProperty(expression.sumExisting, "inputs", {
      value: expression,
    });
    expect(expressionSchema.safeParse(expression).success).toBe(false);
  });

  test.each([false, true])(
    "rejects executable property accessors without reading them (inherited: %s)",
    (inherited) => {
      let reads = 0;
      const properties = Object.defineProperty({}, "sum", {
        enumerable: true,
        get: () => {
          reads++;
          return 1;
        },
      });
      const expression: unknown = inherited
        ? Object.create(properties)
        : properties;
      const result = expressionSchema.safeParse(expression);
      expect(result.success).toBe(false);
      expect(reads).toBe(0);
    },
  );

  test("preserves timestamps in opaque template fields", () => {
    const date = new Date("2026-10-01T00:00:00Z");
    const expression = { template: "score", fields: { date } };
    expect(expressionSchema.parse(expression)).toEqual(expression);
  });
});

test.each(['{"sum":[1],"__proto__":{}}', '{"literal":1,"__proto__":{}}'])(
  "strict expression keys cannot disappear during object parsing: %s",
  (source) => {
    expect(expressionSchema.safeParse(JSON.parse(source)).success).toBe(false);
  },
);

test("validation checks unselected branches and reports their actual operand path", () => {
  const result = expressionSchema.safeParse({
    case: {
      rules: [
        { when: true, value: 1 },
        { default: true, value: { sum: [1, "bad"] } },
      ],
    },
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(
      result.error.issues.some(
        (issue) => issue.path.join(".") === "case.rules.1.value.sum.1",
      ),
    ).toBe(true);
});
