import { referenceSchema } from "../schemas/reference.js";
import {
  getReferenceKeyAndPath,
  type ReferenceKeyAndPath,
} from "../utils/reference.js";

/** Both dispatch paths must fetch and read the same candidate-only keys. */
export function eligibilityReference(
  reference: unknown,
): ReferenceKeyAndPath | undefined {
  const parsed = referenceSchema.safeParse(reference);
  // A future group's positions cannot be resolved from a candidate snapshot.
  // Malformed host input is left to validation rather than failing a tick.
  if (!parsed.success || parsed.data.position !== "self") return undefined;
  return getReferenceKeyAndPath(parsed.data);
}
