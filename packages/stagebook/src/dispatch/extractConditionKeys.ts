import { eligibilityReference } from "./eligibilityReference.js";
import type { DispatchConditionNode, Treatment } from "./types.js";

/**
 * Walk every treatment's `groupComposition[].conditions` tree, parse the
 * leaf references, and return the set of storage-keys that the host
 * needs to populate for each candidate player before calling
 * `makeEligibilityTable`.
 *
 * Per #298, leaf references begin with a position selector. Eligibility
 * conditions on a slot are evaluated against the *candidate* — only
 * `self.X.Y` references actually carry information. Numeric / `shared` /
 * `all` selectors would require knowing the eventual group composition
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
      walk(slot?.conditions, keys);
    }
  }
  return keys;
}

function walk(
  node: DispatchConditionNode | DispatchConditionNode[] | undefined,
  keys: Set<string>,
): void {
  if (node === undefined || node === null) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, keys);
    return;
  }
  if (typeof node !== "object") return;
  if ("all" in node && Array.isArray(node.all)) {
    for (const child of node.all) walk(child, keys);
    return;
  }
  if ("any" in node && Array.isArray(node.any)) {
    for (const child of node.any) walk(child, keys);
    return;
  }
  if ("none" in node && Array.isArray(node.none)) {
    for (const child of node.none) walk(child, keys);
    return;
  }
  if ("reference" in node) {
    const parsed = eligibilityReference(node.reference);
    if (parsed) keys.add(parsed.referenceKey);
  }
}
