import { Missing } from "../expressions/missing.js";
import { referenceSchema, type ReferenceType } from "../schemas/reference.js";
import { checkResponse } from "./checkResponse.js";
import { getNestedValueByPath, getReferenceKeyAndPath } from "./reference.js";

export interface ReferenceReadContext {
  /** Current seat when known. Before assignment, self uses the host's player
   * scope, so intro references work without an invented seat number. */
  position?: number;
  /** A ready, known roster size is required only for everyone references. */
  playerCount?: number;
}

export type ReferenceGetter = (key: string, scope: string) => unknown[];

const MAX_NORMALIZATION_NODES = 10_000;
interface NormalizationState {
  active: Set<unknown[]>;
  normalized: Map<unknown[], unknown[]>;
  nodes: number;
  exhausted: boolean;
}

/** Normalize absent list positions without changing nonmissing stored values.
 * Whole records pass through unchanged; prompt-answer blankness is applied to
 * the addressed answer, not recursively to arbitrary string/list members.
 * Each stored seat value has the evaluator's 10,000-node normalization budget;
 * exhaustion makes that whole value Missing, never a partially copied list. */
function normalizeMissing(
  value: unknown,
  state: NormalizationState = {
    active: new Set(),
    normalized: new Map(),
    nodes: 0,
    exhausted: false,
  },
  depth = 0,
): unknown {
  if (state.exhausted || ++state.nodes > MAX_NORMALIZATION_NODES) {
    state.exhausted = true;
    return Missing;
  }
  if (value === null || value === undefined) return Missing;
  if (!Array.isArray(value)) return value;
  if (state.active.has(value) || depth >= 128) return Missing;
  const cached = state.normalized.get(value);
  if (cached !== undefined) return cached;
  const length = value.length;
  // Every member costs at least one node. Reject a list that cannot fit
  // before invoking any member getters or allocating its normalized copy.
  if (length > MAX_NORMALIZATION_NODES - state.nodes) {
    state.exhausted = true;
    return Missing;
  }
  state.active.add(value);
  try {
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
      if (state.nodes >= MAX_NORMALIZATION_NODES) {
        state.exhausted = true;
        return Missing;
      }
      const member = normalizeMissing(value[index], state, depth + 1);
      if (state.exhausted) return Missing;
      result.push(member);
    }
    // Cache only completed arrays: aliases share one copy while active cycle
    // edges remain Missing, and a small shared graph cannot expand into a tree.
    state.normalized.set(value, result);
    return result;
  } finally {
    state.active.delete(value);
  }
}

/** Read one reference from a ready host snapshot. A single position returns
 * its value directly. Everyone returns one value per seat, retaining Missing
 * positions; no host "all" scope or transport-array filtering is involved.
 *
 * Missing is data absence, never a loading state. An unknown group roster,
 * invalid reference/context, or host exception is a programmer/precondition
 * error and throws rather than pretending participants supplied no answer.
 *
 * The result remains unknown because gradual expression type checks must see
 * wrong host value types and report them; this boundary does not coerce them. */
export function readReference(
  reference: string | ReferenceType,
  get: ReferenceGetter,
  context: ReferenceReadContext = {},
): unknown {
  const parsed = referenceSchema.parse(reference);
  const { referenceKey, path } = getReferenceKeyAndPath(parsed);
  const promptAnswer =
    parsed.source === "prompt" && path.length === 1 && path[0] === "value";

  function readScope(scope: string): unknown {
    const records = get(referenceKey, scope);
    const value = getNestedValueByPath(records[0], path);
    if (promptAnswer && checkResponse(value).blank) return Missing;
    return normalizeMissing(value);
  }

  if (parsed.position === "everyone") {
    const { playerCount } = context;
    if (
      playerCount === undefined ||
      !Number.isSafeInteger(playerCount) ||
      playerCount < 0
    ) {
      throw new Error(
        "readReference requires a ready snapshot with a known non-negative integer playerCount for everyone references.",
      );
    }
    return Array.from({ length: playerCount }, (_, seat) =>
      readScope(String(seat)),
    );
  }
  if (parsed.position === "self") {
    const { position } = context;
    if (
      position !== undefined &&
      (!Number.isSafeInteger(position) || position < 0)
    ) {
      throw new Error(
        "readReference context.position must be a non-negative safe integer when supplied.",
      );
    }
    return readScope(position === undefined ? "player" : String(position));
  }
  return readScope(String(parsed.position));
}
