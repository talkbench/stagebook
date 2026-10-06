import {
  evaluateExpression,
  type EvaluateExpressionOptions,
  type ExpressionReference,
} from "../expressions/evaluateExpression.js";
import type { ExpressionNode } from "../schemas/expression.js";

/** A comparator shorthand. The reference selects one value or a group list. */
export interface Condition {
  reference: ExpressionReference;
  comparator: string;
  value?: unknown;
}

export type ConditionNode = ExpressionNode;

/** Evaluate an already-read single value. Lists remain answer values; they
 * are never transport arrays or an implicit cross-participant quantifier. */
export function evaluateCondition(
  condition: Condition,
  value: unknown,
): boolean {
  return evaluateExpression(condition, { readReference: () => value }) === true;
}

/** One condition boundary for visibility, stage gates, dispatch, and lints.
 * Only omitted conditions are unconstrained. An authored root must evaluate
 * to true; Missing and every other value fail the gate. An outer array is
 * the conditions field's implicit all, not a literal list. */
export function evaluateConditions(
  conditions: unknown,
  options: EvaluateExpressionOptions,
): boolean {
  if (conditions === undefined) return true;
  const expression = Array.isArray(conditions)
    ? { all: conditions }
    : conditions;
  return evaluateExpression(expression, options) === true;
}
