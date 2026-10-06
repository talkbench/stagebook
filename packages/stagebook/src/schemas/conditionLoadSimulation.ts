import { evaluateExpression } from "../expressions/evaluateExpression.js";
import { walkExpression } from "../expressions/walkExpression.js";
import { readReference } from "../utils/readReference.js";
import { getReferenceKeyAndPath } from "../utils/reference.js";
import { resolvedExpressionConditionsSchema } from "./expression.js";
import { referenceSchema } from "./reference.js";

export interface ConditionLoadContext {
  /** Keys first produced by this stage. Keys already produced by a prior step
   * must be excluded: their stored values are unknown, not necessarily absent. */
  currentKeys: ReadonlySet<string>;
  /** Known roster only. An unexpanded playerCount is never replaced with zero. */
  playerCount?: number;
}

interface Dependencies {
  hasCurrent: boolean;
  unknown: boolean;
}
type Truths = readonly boolean[];
const unconstrained: Truths = [false, true];
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Prove a Boolean condition false at load, without guessing prior or external
 * values. Fully known subtrees use the production evaluator and read boundary.
 * For mixed trees, only Boolean composition is approximated; arbitrary numeric,
 * list, case, and reference-dependent operations remain unconstrained.
 *
 * Independently combining operand possibilities is an overapproximation: it
 * may miss a proof when operands are correlated, but cannot invent one. */
export function conditionIsAlwaysFalseAtLoad(
  conditions: unknown,
  context: ConditionLoadContext,
): boolean {
  // Syntax errors and unresolved templates have their own diagnostics. This
  // also bounds traversal and rejects cyclic YAML aliases before simulation.
  if (!resolvedExpressionConditionsSchema.safeParse(conditions).success)
    return false;
  const expression = Array.isArray(conditions)
    ? { all: conditions }
    : conditions;
  const cache = new WeakMap<object, Dependencies>();
  const knownRoster =
    context.playerCount !== undefined &&
    Number.isSafeInteger(context.playerCount) &&
    context.playerCount > 0 &&
    context.playerCount <= 10000;

  function dependencies(node: unknown): Dependencies {
    if (node && typeof node === "object") {
      const cached = cache.get(node);
      if (cached) return cached;
    }
    const result: Dependencies = { hasCurrent: false, unknown: false };
    for (const visit of walkExpression(node)) {
      // Validation never runs author regex patterns against data. Keep these
      // trees unprovable even when all referenced values are known at load.
      if (
        visit.operator === "matches" ||
        (visit.kind === "leaf" &&
          record(visit.node) &&
          (visit.node.comparator === "matches" ||
            visit.node.comparator === "doesNotMatch"))
      )
        result.unknown = true;
      if (
        (visit.kind !== "reference" && visit.kind !== "leaf") ||
        !record(visit.node)
      )
        continue;
      const parsed = referenceSchema.safeParse(visit.node.reference);
      if (!parsed.success) {
        result.unknown = true;
        continue;
      }
      const { referenceKey } = getReferenceKeyAndPath(parsed.data);
      if (context.currentKeys.has(referenceKey)) result.hasCurrent = true;
      else result.unknown = true;
      if (parsed.data.position === "everyone" && !knownRoster)
        result.unknown = true;
    }
    if (node && typeof node === "object") cache.set(node, result);
    return result;
  }

  function evaluateKnown(node: unknown): boolean {
    return (
      evaluateExpression(node, {
        readReference: (reference) =>
          readReference(reference, () => [], {
            playerCount: context.playerCount,
          }),
      }) === true
    );
  }

  function possibilities(node: unknown): Truths {
    if (!dependencies(node).unknown) return [evaluateKnown(node)];
    if (!record(node)) return unconstrained;
    const operator = ["all", "any", "none"].find((key) =>
      Object.prototype.hasOwnProperty.call(node, key),
    );
    if (!operator) return unconstrained;
    const inputs: unknown[] = Array.isArray(node[operator])
      ? (node[operator] as unknown[])
      : [node[operator]];
    const operands = inputs.map(possibilities);
    // all/any are monotone Boolean functions and none is antitone. Evaluating
    // the lower and upper assignments therefore captures both extreme results
    // without an exponential Cartesian product, using the actual truth rules.
    const lower = operands.map((values) => !values.includes(false));
    const upper = operands.map((values) => values.includes(true));
    return [
      evaluateKnown({ [operator]: lower }),
      evaluateKnown({ [operator]: upper }),
    ];
  }

  return (
    dependencies(expression).hasCurrent &&
    !possibilities(expression).includes(true)
  );
}
