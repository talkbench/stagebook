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
    // Condition references (leaf or boolean-tree)
    if (Array.isArray(element.conditions)) {
      for (const condition of element.conditions) {
        collectFromConditionNode(condition, refs);
      }
    }

    // Display element references
    if (element.type === "display" && typeof element.reference === "string") {
      refs.add(element.reference);
    }
  }

  return [...refs];
}

/**
 * Recursively walk a condition node, adding any string references found at
 * leaf nodes. Operator nodes (`all`/`any`/`none`) hold an array of child
 * nodes that may themselves be operators or leaves.
 */
function collectFromConditionNode(node: unknown, refs: Set<string>): void {
  if (!node || typeof node !== "object") return;

  // Leaf: `{ reference, comparator, value? }`
  if (
    "reference" in node &&
    typeof (node as { reference: unknown }).reference === "string"
  ) {
    refs.add((node as { reference: string }).reference);
    return;
  }

  // Operator: `{ all: [...] }`, `{ any: [...] }`, `{ none: [...] }`.
  // Schema enforces exactly one of these keys per node, but we walk
  // every operator we recognize so the inspector handles malformed
  // multi-key nodes gracefully.
  for (const op of ["all", "any", "none"] as const) {
    const children = (node as Record<string, unknown>)[op];
    if (Array.isArray(children)) {
      for (const child of children) {
        collectFromConditionNode(child, refs);
      }
    }
  }
}
