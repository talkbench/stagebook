import { walkConditionLeaves } from "../../expressions/index.js";

/**
 * Scan a stage's elements and extract DSL references that affect rendering.
 * These are the values the state inspector should display for the current stage.
 *
 * Walks both leaf-shaped conditions (`{reference, comparator, value?}`) AND
 * the boolean-tree operators introduced by #235 (`{all:[...]}`,
 * `{any:[...]}`, `{none:[...]}`). Without the recursion, a stage whose
 * conditions are wrapped in `all:`/`any:`/`none:` produces an empty
 * reference list and the inspector misleadingly says "No external
 * references on this stage."
 */
export function extractStageReferences(
  elements: Record<string, unknown>[],
): string[] {
  const refs = new Set<string>();

  for (const element of elements) {
    for (const { leaf } of walkConditionLeaves(element.conditions)) {
      if (typeof leaf.reference === "string") refs.add(leaf.reference);
    }

    // Display element references
    if (element.type === "display" && typeof element.reference === "string") {
      refs.add(element.reference);
    }
  }

  return [...refs];
}
