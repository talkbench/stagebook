import { walkExpression } from "../../expressions/index.js";
import { formatReference, referenceSchema } from "../../schemas/reference.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Discover the references that affect this stage using the expression
 * vocabulary. Literal payloads and unexpanded template fields stay opaque.
 * Strings retain their authored spelling, including invalid references that
 * the inspector can display with a diagnostic; structured forms are formatted. */
export function extractStageReferences(
  elements: Record<string, unknown>[],
  stage?: { conditions?: unknown; discussion?: unknown },
): string[] {
  const refs = new Set<string>();
  const add = (reference: unknown) => {
    if (typeof reference === "string") refs.add(reference);
    else {
      const parsed = referenceSchema.safeParse(reference);
      if (parsed.success) refs.add(formatReference(parsed.data));
    }
  };
  const conditions = (value: unknown) => {
    for (const visit of walkExpression(value, { allowImplicitArray: true })) {
      if (
        (visit.kind === "leaf" || visit.kind === "reference") &&
        record(visit.node)
      )
        add(visit.node.reference);
    }
  };
  conditions(stage?.conditions);
  if (record(stage?.discussion)) conditions(stage.discussion.conditions);
  for (const element of elements) {
    conditions(element.conditions);
    if (element.type === "display") add(element.reference);
    if (
      (element.type === "trackedLink" || element.type === "qualtrics") &&
      Array.isArray(element.urlParams)
    ) {
      for (const parameter of element.urlParams)
        if (record(parameter)) add(parameter.reference);
    }
  }
  return [...refs];
}
