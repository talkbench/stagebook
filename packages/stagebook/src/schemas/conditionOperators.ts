/**
 * Expression operator keys exposed through the historical conditions API.
 *
 * Lives in its own module so both `treatment.ts` (where the operator
 * schemas are composed) and `validateReferences.ts` (where the walker
 * traverses them) can import it without forming an import cycle —
 * `treatment.ts` imports `validateReferences.ts` for cross-stage
 * checks, so the dependency arrow has to point the other way for the
 * shared list.
 */
export {
  EXPRESSION_OPERATOR_KEYS as OPERATOR_KEYS,
  type ExpressionOperatorKey as OperatorKey,
  type BooleanConditionNode,
} from "../expressions/operators.js";
