/**
 * Source-of-truth list of boolean-tree operator keys (#235).
 *
 * Lives in its own module so both `treatment.ts` (where the operator
 * branches are defined) and `validateReferences.ts` (where the walker
 * traverses them) can import it without forming an import cycle —
 * `treatment.ts` imports `validateReferences.ts` for cross-stage
 * checks, so the dependency arrow has to point the other way for the
 * shared list.
 */
export {
  BOOLEAN_OPERATOR_KEYS as OPERATOR_KEYS,
  type BooleanOperatorKey as OperatorKey,
  type BooleanConditionNode,
} from "../expressions/operators.js";
