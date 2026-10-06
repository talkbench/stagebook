import { eligibilityReference } from "./eligibilityReference.js";
import type { Treatment } from "./types.js";
import { walkExpression } from "../expressions/walkExpression.js";

/**
 * Walk every treatment's `groupComposition[].conditions` tree, parse the
 * references in every operand and branch, and return the storage-keys the host
 * needs to populate for each candidate player before calling
 * `makeEligibilityTable`.
 *
 * References begin with a position selector. Eligibility
 * conditions on a slot are evaluated against the *candidate* — only
 * `self.X.Y` references actually carry information. Numeric / `shared` /
 * `everyone` selectors would require knowing the eventual group composition
 * (a circular dependency) and so are skipped here with a comment rather
 * than silently included in the key set.
 *
 * Malformed references are silently skipped: this helper is run in the
 * dispatch hot path on already-validated treatments; raising would
 * convert a recoverable empty-eligibility row into a fatal tick failure.
 */
export function extractConditionKeys(treatments: Treatment[]): Set<string> {
  const keys = new Set<string>();
  for (const t of treatments) {
    const gc = t.groupComposition;
    if (!Array.isArray(gc)) continue;
    for (const slot of gc) {
      for (const { node, kind } of walkExpression(slot?.conditions, {
        allowImplicitArray: true,
      })) {
        if (
          (kind !== "reference" && kind !== "leaf") ||
          node === null ||
          typeof node !== "object" ||
          Array.isArray(node)
        )
          continue;
        const parsed = eligibilityReference(
          (node as Record<string, unknown>).reference,
        );
        if (parsed) keys.add(parsed.referenceKey);
      }
    }
  }
  return keys;
}
