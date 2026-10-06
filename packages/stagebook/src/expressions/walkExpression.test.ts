import { describe, expect, it } from "vitest";
import { conditionsSchema } from "../schemas/treatment.js";
import { resolvedConditionsSchema } from "../schemas/resolved.js";
import {
  EXPRESSION_OPERATOR_KEYS,
  EXPRESSION_OPERATORS,
  hasNonAllAncestor,
  walkConditionLeaves,
  walkExpression,
} from "./index.js";

const ref = (name: string) => ({ reference: `self.prompt.${name}.value` });
const leaf = (name: string) => ({ ...ref(name), comparator: "exists" });

function references(expression: unknown) {
  return [...walkExpression(expression)]
    .filter((visit) => visit.kind === "reference" || visit.kind === "leaf")
    .map(({ node, path }) => ({ node, path }));
}

describe("expression operator metadata", () => {
  it("contains the settled 28 operators, without removed proposals", () => {
    expect(EXPRESSION_OPERATOR_KEYS).toHaveLength(28);
    expect(new Set(EXPRESSION_OPERATOR_KEYS).size).toBe(28);
    expect(EXPRESSION_OPERATORS).not.toHaveProperty("allExist");
    expect(EXPRESSION_OPERATORS).not.toHaveProperty("countUniqueExisting");
    expect(EXPRESSION_OPERATORS).not.toHaveProperty("append");
  });
});

describe("walkExpression", () => {
  it("records enclosing paths and named operand roles", () => {
    const expression = {
      case: {
        rules: [
          {
            when: true,
            value: {
              divide: { numerator: 1, denominator: ref("denominator") },
            },
          },
        ],
      },
    };
    const visit = [
      ...walkExpression(expression, { path: ["expression"] }),
    ].find(({ kind }) => kind === "reference");
    expect(visit?.ancestors).toEqual([
      { operator: "case", path: ["expression"], role: "value" },
      {
        operator: "divide",
        path: ["expression", "case", "rules", 0, "value"],
        role: "denominator",
      },
    ]);
  });
  it.each([
    "all",
    "any",
    "none",
    "allEqual",
    "allUnique",
    "strictlyIncreasing",
    "nonDecreasing",
    "strictlyDecreasing",
    "nonIncreasing",
    "sum",
    "average",
    "product",
    "min",
    "max",
    "sumExisting",
    "averageExisting",
    "minExisting",
    "maxExisting",
    "countExisting",
    "countTrue",
    "countUnique",
    "firstExisting",
  ])("discovers ordered operands of %s", (operator) => {
    expect(references({ [operator]: [ref("a"), ref("b")] })).toEqual([
      { node: ref("a"), path: [operator, 0] },
      { node: ref("b"), path: [operator, 1] },
    ]);
  });

  it.each([
    "all",
    "any",
    "none",
    "allEqual",
    "allUnique",
    "strictlyIncreasing",
    "nonDecreasing",
    "strictlyDecreasing",
    "nonIncreasing",
    "sum",
    "average",
    "product",
    "min",
    "max",
    "sumExisting",
    "averageExisting",
    "minExisting",
    "maxExisting",
    "countExisting",
    "countTrue",
    "countUnique",
  ])("discovers a single expression input to %s", (operator) => {
    expect(references({ [operator]: ref("a") })).toEqual([
      { node: ref("a"), path: [operator] },
    ]);
  });

  it("preserves paths through named operands and case branches", () => {
    const expression = {
      case: {
        rules: [
          {
            when: leaf("gate"),
            value: {
              subtract: {
                from: ref("a"),
                value: {
                  divide: { numerator: ref("b"), denominator: ref("c") },
                },
              },
            },
          },
          { default: true, value: { length: ref("d") } },
        ],
      },
    };
    expect(references(expression)).toEqual([
      { node: leaf("gate"), path: ["case", "rules", 0, "when"] },
      {
        node: ref("a"),
        path: ["case", "rules", 0, "value", "subtract", "from"],
      },
      {
        node: ref("b"),
        path: [
          "case",
          "rules",
          0,
          "value",
          "subtract",
          "value",
          "divide",
          "numerator",
        ],
      },
      {
        node: ref("c"),
        path: [
          "case",
          "rules",
          0,
          "value",
          "subtract",
          "value",
          "divide",
          "denominator",
        ],
      },
      { node: ref("d"), path: ["case", "rules", 1, "value", "length"] },
    ]);
  });

  it("discovers includes operands and matches string but not literal options", () => {
    expect(
      references({
        all: [
          { includes: { container: ref("list"), members: [ref("member")] } },
          {
            matches: {
              string: ref("text"),
              patterns: [ref("not_a_pattern")],
              flags: ref("not_flags"),
            },
          },
        ],
      }),
    ).toEqual([
      { node: ref("list"), path: ["all", 0, "includes", "container"] },
      { node: ref("member"), path: ["all", 0, "includes", "members", 0] },
      { node: ref("text"), path: ["all", 1, "matches", "string"] },
    ]);
  });

  it.each(["sumExisting", "averageExisting", "minExisting", "maxExisting"])(
    "discovers %s options inputs while keeping atLeast opaque",
    (operator) => {
      expect(
        references({
          [operator]: { inputs: [ref("a"), ref("b")], atLeast: ref("ignored") },
        }),
      ).toEqual([
        { node: ref("a"), path: [operator, "inputs", 0] },
        { node: ref("b"), path: [operator, "inputs", 1] },
      ]);
    },
  );

  it("keeps literal payloads, references, leaf values, and templates opaque", () => {
    const structured = {
      reference: {
        position: "self",
        source: "prompt",
        name: "x",
        path: ["value"],
        extra: ref("hidden"),
      },
    };
    const comparison = { ...leaf("x"), value: ref("hidden") };
    expect(
      references({
        all: [
          { literal: [ref("hidden")] },
          structured,
          comparison,
          {
            template: "rule",
            fields: { nested: ref("hidden") },
            all: [ref("hidden")],
          },
          { unknown: { all: [ref("hidden")] } },
        ],
      }),
    ).toEqual([
      { node: structured, path: ["all", 1] },
      { node: comparison, path: ["all", 2] },
    ]);
  });

  it("does not interpret a bare root list as an expression without opt-in", () => {
    expect(references([ref("a")])).toEqual([]);
    const visits = [
      ...walkExpression([ref("a")], {
        path: ["conditions"],
        allowImplicitArray: true,
      }),
    ];
    expect(visits.find((visit) => visit.kind === "reference")?.path).toEqual([
      "conditions",
      0,
    ]);
  });

  it("preserves distinct authored paths to shared acyclic nodes", () => {
    const shared = ref("a");
    expect(references({ all: [shared, shared] })).toEqual([
      { node: shared, path: ["all", 0] },
      { node: shared, path: ["all", 1] },
    ]);
  });

  it("does not follow inherited operator fields or built-in object properties", () => {
    expect(references(Object.create({ all: [ref("hidden")] }))).toEqual([]);
    expect(references({ constructor: { all: [ref("hidden")] } })).toEqual([]);
  });
});

describe("condition grammar boundary", () => {
  it.each([
    { literal: true },
    { all: leaf("a") },
    { case: { rules: [{ when: true, value: true }] } },
  ])("accepts scalar Boolean expressions: %j", (expression) => {
    expect(conditionsSchema.safeParse(expression).success).toBe(true);
    expect(resolvedConditionsSchema.safeParse(expression).success).toBe(true);
  });
  it.each([
    { sum: [1, 2] },
    { reference: "everyone.prompt.a.value", comparator: "exists" },
  ])("rejects a non-Boolean condition root: %j", (expression) => {
    expect(conditionsSchema.safeParse(expression).success).toBe(false);
    expect(resolvedConditionsSchema.safeParse(expression).success).toBe(false);
  });
});

describe("walkConditionLeaves compatibility", () => {
  it("preserves implicit-array paths and actual boolean ancestors", () => {
    const visits = [
      ...walkConditionLeaves(
        [leaf("a"), { all: [{ any: [{ none: [leaf("b")] }] }] }],
        ["treatments", 0, "conditions"],
      ),
    ];
    expect(visits.map(({ leaf: node, path }) => ({ node, path }))).toEqual([
      { node: leaf("a"), path: ["treatments", 0, "conditions", 0] },
      {
        node: leaf("b"),
        path: ["treatments", 0, "conditions", 1, "all", 0, "any", 0, "none", 0],
      },
    ]);
    expect(visits[0].ancestors).toEqual([]);
    expect(visits[1].ancestors.map(({ operator }) => operator)).toEqual([
      "all",
      "any",
      "none",
    ]);
    expect(hasNonAllAncestor(visits[0].ancestors)).toBe(false);
    expect(hasNonAllAncestor(visits[1].ancestors)).toBe(true);
  });

  it("does not mistake path prefixes for operator ancestors", () => {
    const [visit] = [
      ...walkConditionLeaves({ all: [leaf("a")] }, ["any", "none"]),
    ];
    expect(hasNonAllAncestor(visit.ancestors)).toBe(false);
  });

  it("retains first array-valued boolean operator precedence on malformed nodes", () => {
    expect(
      [...walkConditionLeaves({ all: [leaf("a")], any: [leaf("b")] })].map(
        ({ leaf: node }) => node,
      ),
    ).toEqual([leaf("a")]);
    expect(
      [...walkConditionLeaves({ all: "${pending}", any: [leaf("b")] })].map(
        ({ leaf: node }) => node,
      ),
    ).toEqual([leaf("b")]);
  });

  it("does not enable scalar operands or future expression operators", () => {
    const scalarOperator = { all: leaf("a") };
    const futureOperator = { sum: [ref("a")] };
    expect(
      [...walkConditionLeaves([scalarOperator, futureOperator])].map(
        ({ leaf: node }) => node,
      ),
    ).toEqual([scalarOperator, futureOperator]);
  });

  it("skips primitive values and template payloads without throwing", () => {
    expect([
      ...walkConditionLeaves([
        null,
        undefined,
        1,
        "${node}",
        { template: "rule", fields: { all: [leaf("hidden")] } },
      ]),
    ]).toEqual([]);
  });

  it("handles cycles in arrays and operators", () => {
    const root: unknown[] = [leaf("a")];
    root.push(root, { all: root });
    expect([...walkConditionLeaves(root)]).toEqual([]);
  });
});

describe("expression traversal resource bounds", () => {
  const walkers = [
    ["full", (input: unknown) => [...walkExpression(input)]],
    ["legacy", (input: unknown) => [...walkConditionLeaves(input)]],
  ] as const;

  it.each(walkers)(
    "%s skips excessive depth before recursive walking",
    (_, walk) => {
      let expression: unknown = leaf("a");
      for (let depth = 0; depth < 3000; depth++)
        expression = { all: [expression] };
      expect(walk(expression).length).toBe(0);
    },
  );

  it.each(walkers)(
    "%s counts repeated aliases against its work budget",
    (_, walk) => {
      let expression: unknown = leaf("a");
      for (let depth = 0; depth < 15; depth++)
        expression = { all: [expression, expression] };
      expect(walk(expression).length).toBe(0);
    },
  );

  it.each(walkers)(
    "%s rejects cycles before returning partial visits",
    (_, walk) => {
      const expression: { all: unknown[] } = { all: [leaf("a")] };
      expression.all.push(expression);
      expect(walk(expression).length).toBe(0);
    },
  );

  it("bounds work in oversized case rule containers before reading every item", () => {
    let reads = 0;
    const rule = { when: true, value: ref("a") };
    const rules = Array.from({ length: 20_000 }, () => rule);
    for (let index = 0; index < rules.length; index++)
      Object.defineProperty(rules, index, {
        get: () => {
          reads++;
          return rule;
        },
      });
    expect([...walkExpression({ case: { rules } })].length).toBe(0);
    expect(reads).toBeLessThan(10_001);
  });

  it("retains valid wide inputs near the work budget", () => {
    const values = Array.from({ length: 9000 }, () => true);
    const visits = [...walkExpression({ all: values })];
    expect(visits).toHaveLength(9001);
    expect(visits.at(-1)?.path).toEqual(["all", 8999]);
  });

  it("counts input depth independently of the supplied source path", () => {
    let expression: unknown = true;
    for (let depth = 0; depth < 64; depth++) expression = { all: [expression] };
    const prefix = Array.from({ length: 150 }, () => "source");
    expect([...walkExpression(expression, { path: prefix })]).toHaveLength(65);
    expect([...walkExpression({ all: [expression] })].length).toBe(0);
  });
});
