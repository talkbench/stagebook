import React from "react";
import type { EvaluateExpressionOptions } from "../../expressions/evaluateExpression.js";
import {
  evaluateConditions,
  type Condition,
  type ConditionNode,
} from "../../utils/evaluateConditions.js";

export type { Condition, ConditionNode };

export interface ConditionsConditionalRenderProps {
  /** A `conditions:` value: a flat array (implicit `all`), an operator
   *  expression tree, a single leaf, or undefined (no gate). */
  conditions: ConditionNode[] | ConditionNode | null | undefined;
  readReference: EvaluateExpressionOptions["readReference"];
  onViolation?: EvaluateExpressionOptions["onViolation"];
  violationKeys?: Set<string>;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Renders `children` when the condition tree evaluates to true,
 * `fallback` otherwise. Delegates to `evaluateConditions`, which
 * shares the expression evaluator's Missing and explicit-waiting rules.
 */
export function ConditionsConditionalRender({
  conditions,
  readReference,
  onViolation,
  violationKeys,
  children,
  fallback = null,
}: ConditionsConditionalRenderProps) {
  const conditionMet = evaluateConditions(conditions, {
    readReference,
    onViolation,
    violationKeys,
  });
  return <>{conditionMet ? children : fallback}</>;
}
