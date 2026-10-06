import { referenceSchema, type ReferenceType } from "../schemas/reference.js";
import { Missing } from "./missing.js";
import { matchPatterns, parseRegexLiteral } from "./regex.js";
import {
  EXPRESSION_OPERATOR_KEYS,
  EXPRESSION_OPERATORS,
  type ExpressionOperatorKey,
} from "./operators.js";

export { Missing } from "./missing.js";

export type ExpressionScalar = string | number | boolean;
/** Records can be read by a presence leaf or passed through a branch. Operators
 * that require scalars or flat lists check them at the point of consumption. */
export type ExpressionValue =
  | ExpressionScalar
  | Missing
  | readonly ExpressionValue[]
  | Readonly<Record<string, unknown>>;

export type ExpressionReference = string | ReferenceType;

export interface ExpressionTypeViolation {
  kind: "typeMismatch";
  reference: ExpressionReference;
  expected: string;
  actual: string;
}

export interface EvaluateExpressionOptions {
  /** A ready snapshot read: one value for a single position, one entry per
   * seat for everyone. readReference owns source-specific blank normalization. */
  readReference: (reference: ExpressionReference) => unknown;
  onViolation?: (violation: ExpressionTypeViolation) => void;
  /** Hosts may retain this set to deduplicate reports across reevaluations.
   * Without it, duplicate reports are suppressed for this evaluation only. */
  violationKeys?: Set<string>;
}

interface Result {
  value: ExpressionValue;
  reference?: ExpressionReference;
}

type ScalarType = "string" | "number" | "boolean";
type ExpectedType =
  | ScalarType
  | "scalar"
  | "scalarOrList"
  | "stringOrList"
  | "value";
interface ConcreteType {
  scalar?: ScalarType;
  list: boolean;
}
type Expectation =
  | ExpectedType
  | ConcreteType
  | { collection: ExpectedType | ConcreteType };

const absent = (): Result => ({ value: Missing });
const result = (value: ExpressionValue): Result => ({ value });
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const valueList = (
  value: ExpressionValue,
): value is readonly ExpressionValue[] => Array.isArray(value);
const scalar = (value: unknown): value is ExpressionScalar =>
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));
const normalizedText = (value: string) => value.trim().toLowerCase();
const equalityKey = (value: ExpressionValue) =>
  typeof value === "string" ? normalizedText(value) : value;
const keysAre = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const finite = (value: number): Result =>
  result(Number.isFinite(value) ? value : Missing);
const MAX_DEPTH = 128;
const MAX_NODES = 10_000;

interface NormalizationState {
  active: Set<object>;
  cache: WeakMap<object, ExpressionValue>;
  nodes: number;
}

function normalize(
  value: unknown,
  state: NormalizationState = {
    active: new Set(),
    cache: new WeakMap(),
    nodes: 0,
  },
  depth = 0,
  onInvalid?: (expected: string, actual: string) => void,
): ExpressionValue {
  if (
    value === Missing ||
    value === null ||
    value === undefined ||
    depth > MAX_DEPTH ||
    ++state.nodes > MAX_NODES
  )
    return Missing;
  if (scalar(value)) return value;
  if (Array.isArray(value)) {
    if (state.active.has(value) || value.length > MAX_NODES) return Missing;
    if (state.cache.has(value)) return state.cache.get(value)!;
    state.active.add(value);
    try {
      const normalized: ExpressionValue[] = [];
      for (const item of value) {
        normalized.push(normalize(item, state, depth + 1, onInvalid));
        if (state.nodes > MAX_NODES) return Missing;
      }
      state.cache.set(value, normalized);
      return normalized;
    } finally {
      state.active.delete(value);
    }
  }
  if (record(value)) return value;
  onInvalid?.(
    typeof value === "number" ? "finite number" : "value",
    typeof value,
  );
  return Missing;
}

/** Reference syntax is shared with readReference and authoring validation. */
function referenceInfo(
  value: unknown,
):
  | { reference: ExpressionReference; everyone: boolean; key: string }
  | undefined {
  const parsed = referenceSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const descriptor = parsed.data;
  return {
    reference: value as ExpressionReference,
    everyone: descriptor.position === "everyone",
    key: JSON.stringify([
      descriptor.position,
      descriptor.source,
      "name" in descriptor ? descriptor.name : null,
      descriptor.path ?? (descriptor.source === "prompt" ? ["value"] : []),
    ]),
  };
}

function typeName(value: ExpressionValue): string {
  if (value === Missing) return "missing";
  if (!valueList(value)) return typeof value;
  const types = new Set(
    value
      .filter((item) => item !== Missing)
      .map((item) => (Array.isArray(item) ? "list" : typeof item)),
  );
  return types.size === 0
    ? "list"
    : types.size === 1
      ? `${[...types][0]}[]`
      : "mixed[]";
}

function matchesType(value: ExpressionValue, expected: ExpectedType): boolean {
  switch (expected) {
    case "value":
      return true;
    case "scalar":
      return scalar(value);
    case "scalarOrList":
      return (
        scalar(value) ||
        (valueList(value) &&
          value.every((item) => item === Missing || scalar(item)))
      );
    case "stringOrList":
      return (
        typeof value === "string" ||
        (valueList(value) &&
          value.every((item) => item === Missing || scalar(item)))
      );
    default:
      return typeof value === expected;
  }
}

function concreteType(value: ExpressionValue): ConcreteType | undefined {
  if (value === Missing) return undefined;
  if (scalar(value)) return { list: false, scalar: typeof value as ScalarType };
  if (valueList(value)) {
    const present = value.find((item) => item !== Missing);
    return {
      list: true,
      ...(scalar(present) ? { scalar: typeof present as ScalarType } : {}),
    };
  }
  return undefined;
}

function sameValue(a: ExpressionValue, b: ExpressionValue): boolean {
  if (a === Missing || b === Missing) return false;
  if (typeof a === "string" && typeof b === "string")
    return normalizedText(a) === normalizedText(b);
  if (valueList(a) && valueList(b))
    return (
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  return scalar(a) && scalar(b) && a === b;
}

/** Infer only syntax-owned result types. This never reads a reference or runs
 * an unselected branch; static validation remains responsible for conflicts. */
interface StaticTypeState {
  active: Set<object>;
  cache: WeakMap<object, ConcreteType | undefined>;
  nodes: number;
}

function staticType(
  node: unknown,
  state: StaticTypeState,
): ConcreteType | undefined {
  if (scalar(node)) return { list: false, scalar: typeof node as ScalarType };
  if (!record(node)) return undefined;
  if (state.cache.has(node)) return state.cache.get(node);
  if (
    state.active.has(node) ||
    state.active.size > MAX_DEPTH ||
    ++state.nodes > MAX_NODES
  )
    return undefined;
  state.active.add(node);
  let inferred: ConcreteType | undefined;
  try {
    if (own(node, "literal"))
      return (inferred = concreteType(normalize(node.literal)));
    if (own(node, "reference") && own(node, "comparator")) {
      const reference = referenceInfo(node.reference);
      if (reference)
        return (inferred = { list: reference.everyone, scalar: "boolean" });
      return undefined;
    }
    if (Object.keys(node).length !== 1) return undefined;
    const key = Object.keys(node)[0] as ExpressionOperatorKey;
    if (!EXPRESSION_OPERATOR_KEYS.includes(key)) return undefined;
    const definition = EXPRESSION_OPERATORS[key];
    if (definition.resultType !== "operand")
      return (inferred = { list: false, scalar: definition.resultType });
    let children: unknown[] = [];
    if (key === "firstExisting" && Array.isArray(node[key]))
      children = node[key];
    if (key === "case" && record(node.case) && Array.isArray(node.case.rules))
      children = node.case.rules.map((rule: unknown) =>
        record(rule) ? rule.value : undefined,
      );
    return (inferred = knownType(
      children.map((child) => staticType(child, state)),
    ));
  } finally {
    state.active.delete(node);
    state.cache.set(node, inferred);
  }
}

function knownType(
  types: (ConcreteType | undefined)[],
): ConcreteType | undefined {
  const shape = types.find((type) => type !== undefined);
  return shape
    ? {
        ...shape,
        scalar: types.find((type) => type?.list === shape.list && type.scalar)
          ?.scalar,
      }
    : undefined;
}

/** Evaluate an already-validated YAML expression against a ready snapshot.
 * Malformed runtime input fails closed. Evaluation never mutates host values,
 * saves state, subscribes, or relies on JavaScript truthiness. */
export function evaluateExpression(
  expression: unknown,
  options: EvaluateExpressionOptions,
): ExpressionValue {
  const active = new Set<object>();
  // Syntax inference shares the evaluation's lifetime. YAML aliases may
  // reuse branches; infer each object once without reading participant data.
  const staticTypes: StaticTypeState = {
    active: new Set(),
    cache: new WeakMap(),
    nodes: 0,
  };
  const inferType = (node: unknown) => staticType(node, staticTypes);
  const seen = options.violationKeys ?? new Set<string>();
  let nodes = 0;

  function report(
    reference: ExpressionReference,
    expected: string,
    actual: string,
  ): void {
    const info = referenceInfo(reference);
    const key = JSON.stringify([info?.key, expected, actual]);
    if (!seen.has(key)) {
      seen.add(key);
      try {
        options.onViolation?.({
          kind: "typeMismatch",
          reference,
          expected,
          actual,
        });
      } catch {
        /* Diagnostics must not change participant behavior. */
      }
    }
  }

  function mismatch(input: Result, expected: string): Result {
    if (input.reference)
      report(input.reference, expected, typeName(input.value));
    return { ...input, value: Missing };
  }

  function check(input: Result, expected: ExpectedType): Result {
    return input.value === Missing || matchesType(input.value, expected)
      ? input
      : mismatch(input, expected);
  }

  function checkConcrete(input: Result, expected: ConcreteType): Result {
    if (input.value === Missing) return input;
    if (expected.list) {
      if (!valueList(input.value))
        return mismatch(input, `${expected.scalar ?? "scalar"}[]`);
      const values = input.value.map(
        (value) =>
          check(
            { value, reference: input.reference },
            expected.scalar ?? "scalar",
          ).value,
      );
      return { ...input, value: values };
    }
    return check(input, expected.scalar ?? "scalar");
  }

  function checkExpected(input: Result, expected?: Expectation): Result {
    if (!expected) return input;
    if (typeof expected === "string") return check(input, expected);
    if ("collection" in expected) {
      // A quantifier consumes list members lazily; checking the whole list
      // here would report violations from seats it never needs to inspect.
      if (valueList(input.value)) return input;
      return checkExpected(input, expected.collection);
    }
    return checkConcrete(input, expected);
  }

  function branchExpectation(
    expressions: unknown[],
    expected?: Expectation,
  ): Expectation | undefined {
    const known = knownType(expressions.map((node) => inferType(node)));
    if (!known) return expected;
    if (
      typeof expected === "string" &&
      ["number", "boolean", "string"].includes(expected)
    )
      return expected;
    if (expected && typeof expected !== "string" && !("collection" in expected))
      return expected;
    return known;
  }

  function compatible(inputs: Result[], allowLists: boolean): Result[] {
    const checked = inputs.map((input) =>
      check(input, allowLists ? "scalarOrList" : "scalar"),
    );
    // An authored constant supplies a stronger type than a gradual reference.
    const candidates = [
      ...checked.filter((input) => !input.reference),
      ...checked.filter((input) => input.reference),
    ];
    const types = candidates
      .map((input) => concreteType(input.value))
      .filter((type): type is ConcreteType => type !== undefined);
    const shape = types[0];
    if (!shape) return checked;
    const expected = {
      ...shape,
      scalar: types.find((type) => type.list === shape.list && type.scalar)
        ?.scalar,
    };
    return checked.map((input) => checkConcrete(input, expected));
  }

  function read(
    reference: unknown,
  ): { input: Result; everyone: boolean } | undefined {
    const info = referenceInfo(reference);
    if (!info) return undefined;
    // Host/readiness failures are not participant absence. In particular an
    // unloaded roster must never make a negative gate true as if no one answered.
    const value = normalize(
      options.readReference(info.reference),
      { active: new Set(), cache: new WeakMap(), nodes: 0 },
      0,
      (expected, actual) => report(info.reference, expected, actual),
    );
    let input: Result = { value, reference: info.reference };
    if (info.everyone && !Array.isArray(value))
      input = { ...input, ...mismatch(input, "list") };
    return { input, everyone: info.everyone };
  }

  function literal(value: unknown): Result {
    if (Array.isArray(value)) {
      if (
        value.some(
          (item: unknown) =>
            item !== null &&
            item !== undefined &&
            item !== Missing &&
            !scalar(item),
        )
      )
        return absent();
      return result(normalize(value));
    }
    return value === null ||
      value === undefined ||
      value === Missing ||
      scalar(value)
      ? result(normalize(value))
      : absent();
  }

  function* operands(
    value: unknown,
    depth: number,
    expected?: ExpectedType | ConcreteType,
  ): Generator<Result> {
    if (Array.isArray(value)) {
      for (const expression of value)
        yield evaluate(expression, depth + 1, expected);
    } else {
      const input = evaluate(
        value,
        depth + 1,
        expected ? { collection: expected } : undefined,
      );
      if (valueList(input.value)) {
        for (const value of input.value)
          yield checkExpected({ value, reference: input.reference }, expected);
      } else yield input;
    }
  }

  function booleanOperator(
    operator: "all" | "any" | "none",
    value: unknown,
    depth: number,
  ): Result {
    let count = 0;
    for (const input of operands(value, depth, "boolean")) {
      count++;
      const truth = check(input, "boolean").value === true;
      if (operator === "all" && !truth) return result(false);
      if (operator !== "all" && truth) return result(operator === "any");
    }
    return count === 0 ? absent() : result(operator !== "any");
  }

  function numericReduction(
    operator: string,
    inputs: Result[],
    atLeast?: number,
  ): Result {
    const numbers = inputs.map((input) => check(input, "number").value);
    const present = numbers.filter(
      (value): value is number => typeof value === "number",
    );
    if (present.length < (atLeast ?? numbers.length) || present.length === 0)
      return absent();
    const base = operator.replace("Existing", "");
    switch (base) {
      case "sum":
        return finite(present.reduce((a, b) => a + b, 0));
      case "average":
        return finite(present.reduce((a, b) => a + b, 0) / present.length);
      case "product":
        return finite(present.reduce((a, b) => a * b, 1));
      case "min":
        return finite(present.reduce((a, b) => Math.min(a, b)));
      case "max":
        return finite(present.reduce((a, b) => Math.max(a, b)));
      default:
        return absent();
    }
  }

  function compareInputs(
    operator: string,
    inputs: Result[],
    allowLists: boolean,
  ): Result {
    const checked =
      operator === "allEqual" || operator === "allUnique"
        ? compatible(inputs, allowLists)
        : inputs.map((input) => check(input, "number"));
    if (checked.length < 2) return absent();
    const values = checked.map((input) => input.value);
    if (values.some((value) => value === Missing)) return result(false);
    switch (operator) {
      case "allEqual":
        return result(
          values.slice(1).every((value) => sameValue(values[0], value)),
        );
      case "allUnique":
        return result(new Set(values.map(equalityKey)).size === values.length);
      default: {
        const numbers = values as number[];
        return result(
          numbers.slice(1).every((value, index) => {
            switch (operator) {
              case "strictlyIncreasing":
                return numbers[index] < value;
              case "nonDecreasing":
                return numbers[index] <= value;
              case "strictlyDecreasing":
                return numbers[index] > value;
              case "nonIncreasing":
                return numbers[index] >= value;
              default:
                return false;
            }
          }),
        );
      }
    }
  }

  function includes(containerInput: Result, memberInputs: Result[]): Result {
    let container = check(containerInput, "stringOrList");
    const items: Result[] = valueList(container.value)
      ? container.value.map((value) => ({
          value,
          reference: container.reference,
        }))
      : [container];
    const checked = compatible([...items, ...memberInputs], false);
    const members = checked.slice(items.length);
    const containerItems = checked.slice(0, items.length);
    if (!valueList(container.value)) container = containerItems[0];
    if (
      container.value === Missing ||
      members.length === 0 ||
      members.some((member) => member.value === Missing)
    )
      return result(false);
    if (typeof container.value === "string") {
      const string = normalizedText(container.value);
      return result(
        members.every(
          (member) =>
            typeof member.value === "string" &&
            string.includes(normalizedText(member.value)),
        ),
      );
    }
    return result(
      members.every((member) =>
        containerItems.some((item) => sameValue(item.value, member.value)),
      ),
    );
  }

  function length(input: Result): Result {
    const value = check(input, "stringOrList").value;
    return result(
      typeof value === "string" || valueList(value) ? value.length : Missing,
    );
  }

  function matches(input: Result, patterns: unknown, flags: unknown): Result {
    const value = check(input, "string").value;
    // Pattern syntax is still checked for a missing answer, but matching an
    // absent participant value never invokes the regex engine on empty text.
    const matched = matchPatterns(
      typeof value === "string" ? value : Missing,
      patterns,
      flags,
    );
    if (matched === Missing) return absent();
    return result(value === Missing ? false : matched);
  }

  function leaf(
    input: Result,
    comparator: unknown,
    value: unknown,
    hasValue: boolean,
  ): Result {
    if (comparator === "exists" || comparator === "doesNotExist") {
      if (hasValue) return absent();
      return result(
        comparator === "exists"
          ? input.value !== Missing
          : input.value === Missing,
      );
    }
    if (
      !hasValue ||
      value === null ||
      value === undefined ||
      (Array.isArray(value) &&
        value.some((item: unknown) => item === null || item === undefined))
    )
      return absent();
    const other = literal(value);
    if (other.value === Missing) return absent();
    const negative =
      comparator === "doesNotEqual" ||
      comparator === "doesNotInclude" ||
      comparator === "doesNotMatch" ||
      comparator === "isNotOneOf";
    let compared: Result;
    switch (comparator) {
      case "equals":
      case "doesNotEqual":
        compared = compareInputs("allEqual", [input, other], true);
        break;
      case "isAbove":
        compared = compareInputs("strictlyDecreasing", [input, other], false);
        break;
      case "isBelow":
        compared = compareInputs("strictlyIncreasing", [input, other], false);
        break;
      case "isAtLeast":
        compared = compareInputs("nonIncreasing", [input, other], false);
        break;
      case "isAtMost":
        compared = compareInputs("nonDecreasing", [input, other], false);
        break;
      case "hasLengthAtLeast":
      case "hasLengthAtMost":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
          return absent();
        compared = compareInputs(
          comparator === "hasLengthAtLeast" ? "nonIncreasing" : "nonDecreasing",
          [length(input), other],
          false,
        );
        break;
      case "includes":
      case "doesNotInclude":
        if (!scalar(value)) return absent();
        compared = includes(input, [other]);
        break;
      case "isOneOf":
      case "isNotOneOf":
        if (!Array.isArray(value) || value.length === 0 || !value.every(scalar))
          return absent();
        compared = includes(other, [input]);
        break;
      case "matches":
      case "doesNotMatch": {
        if (typeof value !== "string") return absent();
        const parsed = parseRegexLiteral(value);
        if (!parsed) return absent();
        compared = matches(input, [parsed.pattern], parsed.flags);
        break;
      }
      default:
        return absent();
    }
    return negative && compared.value !== Missing
      ? result(compared.value !== true)
      : compared;
  }

  function operator(
    key: ExpressionOperatorKey,
    value: unknown,
    depth: number,
    expected?: Expectation,
  ): Result {
    switch (key) {
      case "all":
      case "any":
      case "none":
        return booleanOperator(key, value, depth);
      case "firstExisting": {
        if (!Array.isArray(value) || value.length === 0) return absent();
        const branchType = branchExpectation(value, expected);
        for (const item of value) {
          const selected = evaluate(item, depth + 1, branchType);
          if (selected.value !== Missing) return selected;
        }
        return absent();
      }
      case "case": {
        if (
          !record(value) ||
          !keysAre(value, ["rules"]) ||
          !Array.isArray(value.rules) ||
          value.rules.length === 0
        )
          return absent();
        const branchType = branchExpectation(
          value.rules.map((rule: unknown) =>
            record(rule) ? rule.value : undefined,
          ),
          expected,
        );
        for (let index = 0; index < value.rules.length; index++) {
          const rule: unknown = value.rules[index];
          if (
            !record(rule) ||
            !keysAre(rule, ["when", "value", "default"]) ||
            !own(rule, "value") ||
            own(rule, "when") === own(rule, "default")
          )
            return absent();
          if (own(rule, "default")) {
            if (rule.default !== true || index !== value.rules.length - 1)
              return absent();
            return evaluate(rule.value, depth + 1, branchType);
          }
          if (evaluate(rule.when, depth + 1, "boolean").value === true)
            return evaluate(rule.value, depth + 1, branchType);
        }
        return absent();
      }
      case "length":
        return length(evaluate(value, depth + 1, "stringOrList"));
      case "subtract":
      case "divide": {
        const names =
          key === "subtract" ? ["from", "value"] : ["numerator", "denominator"];
        if (
          !record(value) ||
          !keysAre(value, names) ||
          names.some((name) => !own(value, name))
        )
          return absent();
        const inputs = names.map(
          (name) => evaluate(value[name], depth + 1, "number").value,
        );
        return typeof inputs[0] === "number" && typeof inputs[1] === "number"
          ? finite(
              key === "subtract"
                ? inputs[0] - inputs[1]
                : inputs[0] / inputs[1],
            )
          : absent();
      }
      case "includes": {
        if (
          !record(value) ||
          !keysAre(value, ["container", "members"]) ||
          !own(value, "container") ||
          !Array.isArray(value.members) ||
          value.members.length === 0
        )
          return absent();
        const container = evaluate(value.container, depth + 1, "stringOrList");
        const memberType =
          knownType(value.members.map((member: unknown) => inferType(member)))
            ?.scalar ??
          inferType(value.container)?.scalar ??
          concreteType(container.value)?.scalar ??
          "scalar";
        const members = value.members.map((item: unknown) =>
          evaluate(item, depth + 1, memberType),
        );
        return includes(container, members);
      }
      case "matches":
        if (
          !record(value) ||
          !keysAre(value, ["string", "patterns", "flags"]) ||
          !own(value, "string")
        )
          return absent();
        return matches(
          evaluate(value.string, depth + 1, "string"),
          value.patterns,
          value.flags ?? "",
        );
      case "sumExisting":
      case "averageExisting":
      case "minExisting":
      case "maxExisting": {
        let inputs = value;
        let atLeast = 1;
        if (record(value) && own(value, "inputs")) {
          if (!keysAre(value, ["inputs", "atLeast"])) return absent();
          inputs = value.inputs;
          if (own(value, "atLeast")) {
            if (
              typeof value.atLeast !== "number" ||
              !Number.isInteger(value.atLeast) ||
              value.atLeast < 1
            )
              return absent();
            atLeast = value.atLeast;
          }
          if (Array.isArray(inputs) && atLeast > inputs.length) return absent();
        }
        return numericReduction(
          key,
          [...operands(inputs, depth, "number")],
          atLeast,
        );
      }
      case "sum":
      case "average":
      case "product":
      case "min":
      case "max":
        return numericReduction(key, [...operands(value, depth, "number")]);
      case "allEqual":
      case "allUnique":
      case "strictlyIncreasing":
      case "nonDecreasing":
      case "strictlyDecreasing":
      case "nonIncreasing": {
        const inputType =
          key === "allEqual" || key === "allUnique"
            ? Array.isArray(value)
              ? (knownType(value.map((item: unknown) => inferType(item))) ??
                (key === "allEqual" ? "scalarOrList" : "scalar"))
              : "scalar"
            : "number";
        return compareInputs(
          key,
          [...operands(value, depth, inputType)],
          key === "allEqual" && Array.isArray(value),
        );
      }
      case "countExisting": {
        const inputs = [...operands(value, depth, "scalar")].map((input) =>
          check(input, "scalar"),
        );
        return result(inputs.filter((input) => input.value !== Missing).length);
      }
      case "countTrue": {
        const inputs = [...operands(value, depth, "boolean")].map((input) =>
          check(input, "boolean"),
        );
        return result(inputs.filter((input) => input.value === true).length);
      }
      case "countUnique": {
        const expected = Array.isArray(value)
          ? (knownType(value.map((item: unknown) => inferType(item)))?.scalar ??
            "scalar")
          : "scalar";
        const inputs = compatible([...operands(value, depth, expected)], false)
          .map((input) => input.value)
          .filter((value) => value !== Missing);
        return result(new Set(inputs.map(equalityKey)).size);
      }
    }
  }

  function evaluate(
    node: unknown,
    depth: number,
    expected?: Expectation,
  ): Result {
    return checkExpected(evaluateNode(node, depth, expected), expected);
  }

  function evaluateNode(
    node: unknown,
    depth: number,
    expected?: Expectation,
  ): Result {
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES) return absent();
    if (!record(node)) return Array.isArray(node) ? absent() : literal(node);
    if (active.has(node)) return absent();
    active.add(node);
    try {
      if (own(node, "literal"))
        return keysAre(node, ["literal"]) ? literal(node.literal) : absent();
      if (own(node, "reference")) {
        if (
          !keysAre(node, ["reference", "comparator", "value"]) ||
          (!own(node, "comparator") && own(node, "value"))
        )
          return absent();
        const readResult = read(node.reference);
        if (!readResult) return absent();
        const { input, everyone } = readResult;
        if (!own(node, "comparator")) return input;
        if (everyone) {
          if (!valueList(input.value)) return absent();
          return result(
            input.value.map(
              (value) =>
                leaf(
                  { value, reference: input.reference },
                  node.comparator,
                  node.value,
                  own(node, "value"),
                ).value,
            ),
          );
        }
        return leaf(input, node.comparator, node.value, own(node, "value"));
      }
      const keys = Object.keys(node);
      if (
        keys.length !== 1 ||
        !EXPRESSION_OPERATOR_KEYS.includes(keys[0] as ExpressionOperatorKey)
      )
        return absent();
      return operator(
        keys[0] as ExpressionOperatorKey,
        node[keys[0]],
        depth,
        expected,
      );
    } finally {
      active.delete(node);
    }
  }

  return evaluate(expression, 0).value;
}
