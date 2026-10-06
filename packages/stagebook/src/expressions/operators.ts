/** Structural metadata for the settled #299 vocabulary. This does not enable
 * these operators in treatment files; schemas still accept only the current
 * boolean condition grammar until the evaluator and validation land together. */
export type ExpressionValueType =
  | "boolean"
  | "number"
  | "string"
  | "scalar"
  | "scalarOrList"
  | "stringOrList"
  | "value";

type LiteralOptions = Readonly<
  Record<string, "string" | "stringList" | "number" | "boolean">
>;

export type ExpressionOperandLayout =
  | {
      kind: "expression" | "expressionList" | "expressionOrList";
      role: string;
      valueType: ExpressionValueType;
    }
  | {
      kind: "fields";
      fields: Readonly<Record<string, ExpressionOperandLayout>>;
      /** Literal-only siblings of these expression fields. */
      options?: LiteralOptions;
    }
  | { kind: "items"; item: ExpressionOperandLayout }
  | {
      kind: "withOptions";
      inputField: string;
      input: ExpressionOperandLayout;
    };

export interface ExpressionOperatorDefinition {
  resultType: "boolean" | "number" | "operand";
  operands: ExpressionOperandLayout;
  /** Options are author-supplied data, never child expressions. */
  options?: LiteralOptions;
}

const input = (
  kind: "expression" | "expressionList" | "expressionOrList",
  role: string,
  valueType: ExpressionValueType,
): ExpressionOperandLayout => ({ kind, role, valueType });

const booleanInputs = input("expressionOrList", "inputs", "boolean");
const numberInputs = input("expressionOrList", "inputs", "number");
const scalarInputs = input("expressionOrList", "inputs", "scalar");

/** Currently accepted condition operator keys, in legacy traversal order. */
export const BOOLEAN_OPERATOR_KEYS = ["all", "any", "none"] as const;

export type BooleanOperatorKey = (typeof BOOLEAN_OPERATOR_KEYS)[number];

const booleanDefinition = {
  resultType: "boolean",
  operands: booleanInputs,
} as const satisfies ExpressionOperatorDefinition;

const booleanOperators = Object.fromEntries(
  BOOLEAN_OPERATOR_KEYS.map((key) => [key, booleanDefinition]),
) as Record<BooleanOperatorKey, typeof booleanDefinition>;

// The interface defers recursion. Directly passing a node alias back into a
// generic operator union is a circular alias TypeScript cannot expand.
interface BooleanConditionNodeMap<Leaf> {
  nodes: {
    [K in BooleanOperatorKey]: { [P in K]: BooleanConditionNode<Leaf>[] };
  };
}

/** Recursive consumers supply their own leaf and reference types. */
export type BooleanConditionNode<Leaf> =
  | Leaf
  | BooleanConditionNodeMap<Leaf>["nodes"][BooleanOperatorKey];

const existingNumberInputs = {
  resultType: "number",
  operands: {
    kind: "withOptions",
    inputField: "inputs",
    input: numberInputs,
  },
  options: { atLeast: "number" },
} as const satisfies ExpressionOperatorDefinition;

export const EXPRESSION_OPERATORS = {
  ...booleanOperators,
  allEqual: {
    resultType: "boolean",
    operands: input("expressionOrList", "inputs", "scalarOrList"),
  },
  allUnique: { resultType: "boolean", operands: scalarInputs },
  strictlyIncreasing: { resultType: "boolean", operands: numberInputs },
  nonDecreasing: { resultType: "boolean", operands: numberInputs },
  strictlyDecreasing: { resultType: "boolean", operands: numberInputs },
  nonIncreasing: { resultType: "boolean", operands: numberInputs },
  includes: {
    resultType: "boolean",
    operands: {
      kind: "fields",
      fields: {
        container: input("expression", "container", "stringOrList"),
        members: input("expressionList", "members", "scalar"),
      },
    },
  },
  matches: {
    resultType: "boolean",
    operands: {
      kind: "fields",
      fields: { string: input("expression", "string", "string") },
    },
    options: { patterns: "stringList", flags: "string" },
  },
  sum: { resultType: "number", operands: numberInputs },
  average: { resultType: "number", operands: numberInputs },
  product: { resultType: "number", operands: numberInputs },
  min: { resultType: "number", operands: numberInputs },
  max: { resultType: "number", operands: numberInputs },
  subtract: {
    resultType: "number",
    operands: {
      kind: "fields",
      fields: {
        from: input("expression", "from", "number"),
        value: input("expression", "value", "number"),
      },
    },
  },
  divide: {
    resultType: "number",
    operands: {
      kind: "fields",
      fields: {
        numerator: input("expression", "numerator", "number"),
        denominator: input("expression", "denominator", "number"),
      },
    },
  },
  length: {
    resultType: "number",
    operands: input("expression", "input", "stringOrList"),
  },
  case: {
    resultType: "operand",
    operands: {
      kind: "fields",
      fields: {
        rules: {
          kind: "items",
          item: {
            kind: "fields",
            fields: {
              when: input("expression", "when", "boolean"),
              value: input("expression", "value", "value"),
            },
            options: { default: "boolean" },
          },
        },
      },
    },
  },
  sumExisting: existingNumberInputs,
  averageExisting: existingNumberInputs,
  minExisting: existingNumberInputs,
  maxExisting: existingNumberInputs,
  firstExisting: {
    resultType: "operand",
    operands: input("expressionList", "inputs", "value"),
  },
  countExisting: { resultType: "number", operands: scalarInputs },
  countTrue: { resultType: "number", operands: booleanInputs },
  countUnique: { resultType: "number", operands: scalarInputs },
} as const satisfies Record<string, ExpressionOperatorDefinition>;

export type ExpressionOperatorKey = keyof typeof EXPRESSION_OPERATORS;

export const EXPRESSION_OPERATOR_KEYS = Object.freeze(
  Object.keys(EXPRESSION_OPERATORS) as ExpressionOperatorKey[],
);
