import { evaluateExpression } from "../expressions/evaluateExpression.js";

export type Comparator =
  | "exists"
  | "doesNotExist"
  | "equals"
  | "doesNotEqual"
  | "isAbove"
  | "isBelow"
  | "isAtLeast"
  | "isAtMost"
  | "hasLengthAtLeast"
  | "hasLengthAtMost"
  | "includes"
  | "doesNotInclude"
  | "matches"
  | "doesNotMatch"
  | "isOneOf"
  | "isNotOneOf";

/** Compare one already-read value using the same rules as every expression.
 * Source-specific blank normalization happens in readReference, before this
 * helper. There is no numeric string coercion or third Boolean state. */
export function compare(
  lhs: unknown,
  comparator: Comparator,
  rhs?: unknown,
): boolean {
  return (
    evaluateExpression(
      {
        reference: "self.attributes.comparisonValue",
        comparator,
        ...(comparator === "exists" || comparator === "doesNotExist"
          ? {}
          : { value: rhs }),
      },
      { readReference: () => lhs },
    ) === true
  );
}
