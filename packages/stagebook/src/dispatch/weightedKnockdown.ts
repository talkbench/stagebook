import type {
  Assignment,
  EligibilityTable,
  LabeledMatrix,
  LabeledScalars,
  Treatment,
} from "./types.js";
import { tryFillTreatment } from "./tryFillTreatment.js";
import { validateLabelSet } from "./validateLabelSet.js";

export interface WeightedKnockdownArgs {
  playerIds: string[];
  treatments: Treatment[];
  /** Per-treatment payoffs, keyed by name. `"equal"` is sugar for
   *  `{name: 1, ...}` across the full treatment set. */
  payoffs: LabeledScalars | "equal";
  /** Multiplicative knockdown factors applied after a successful pick.
   *  See the dispatcher docstring for the four supported shapes. */
  knockdowns: number | LabeledScalars | LabeledMatrix | "none";
  /** Softmax temperature ≥ 0. `0` (the default) is argmax + random
   *  tiebreak; `> 0` softmaxes over `payoffs / T`. */
  temperature?: number;
  eligibility: EligibilityTable;
  rng: () => number;
}

export interface WeightedKnockdownResult {
  assignments: Assignment[];
  /** Updated payoff vector after the within-batch knockdowns. The host
   *  threads this back into the next call's `payoffs` to carry the
   *  attenuation forward. Always returned in labeled form, even if
   *  the input used the `"equal"` shorthand. */
  newState: { payoffs: LabeledScalars };
}

/**
 * Softmax-sampled, payoff-with-knockdown dispatcher (#452). Replaces
 * the v0.14 `local-penalization` placeholder. The algorithm in one
 * line: each round, pick a size-feasible treatment by softmax over
 * the current payoffs (or argmax + random tiebreak at `T=0`), try to
 * fill it, and on success multiply the payoffs by the configured
 * knockdowns before the next round.
 *
 * State-in / state-out: callers thread `newState.payoffs` into the
 * next call's `payoffs`. The dispatcher itself is pure — no closure
 * mutation — which makes mirroring the dispatcher state to a host
 * heartbeat (deliberation-lab#275) and post-hoc replay both
 * straightforward.
 *
 * Algorithm sketch (per call):
 *   1. Expand `"equal"` payoffs to `{name: 1, ...}`; validate label set.
 *   2. Convert payoffs + knockdowns to positional internally (cheap
 *      arithmetic on dense arrays); labels round-trip at the boundary.
 *   3. While `available.size > 0`:
 *      a. Build the size-feasible pool: `current[i] > 0 ∧
 *         playerCount > 0 ∧ playerCount ≤ available.size ∧ not-tried-
 *         this-round`.
 *      b. Sample one treatment from the pool:
 *           - `T = 0`: argmax with uniform tiebreak over indices at
 *             the max value (sampled via `rng`).
 *           - `T > 0`: softmax `p[i] ∝ exp(current[i] / T)` with
 *             max-subtract for numerical stability.
 *      c. Try to fill via `tryFillTreatment`. On success, emit the
 *         assignment, multiply the payoffs by the knockdown row, and
 *         restart the outer round so the next pick re-ranks against
 *         the updated payoffs. On greedy failure, mark the treatment
 *         "tried this round" and re-sample from the remaining pool.
 *
 * Edge cases:
 *   - All payoffs 0 (or all positive-payoff treatments infeasible):
 *     no assignment, dispatch ends.
 *   - Very large `T`: max-subtract keeps the softmax numerically
 *     stable; the output converges to uniform sampling over the
 *     feasible pool.
 *   - Scalar knockdown of `0` (allowed): a single pick zeros that
 *     treatment's payoff for the rest of the batch.
 */
export function weightedKnockdown({
  playerIds,
  treatments,
  payoffs,
  knockdowns,
  temperature = 0,
  eligibility,
  rng,
}: WeightedKnockdownArgs): WeightedKnockdownResult {
  const n = treatments.length;
  const names = treatments.map((t) => t.name);

  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error(
      `weightedKnockdown: temperature must be a finite number >= 0, got ${String(temperature)}`,
    );
  }

  // Expand `"equal"` shorthand → uniform 1s, validate labeled forms.
  let positionalPayoffs: number[];
  if (payoffs === "equal") {
    positionalPayoffs = new Array(n).fill(1) as number[];
  } else {
    validateLabelSet("weightedKnockdown", "payoffs", payoffs, names);
    positionalPayoffs = names.map((name) => payoffs[name]);
  }

  // Knockdowns: discriminate at the boundary and convert to a function
  // that takes a picked-index and returns the updated positional
  // payoffs. Keeps the inner loop free of shape branching.
  const applyKnockdown = buildKnockdownApplier(knockdowns, names);

  const assignments: Assignment[] = [];
  const available = new Set(playerIds);

  while (available.size > 0) {
    const tried = new Set<number>();
    let progress = false;
    while (true) {
      const pool: number[] = [];
      for (let i = 0; i < n; i += 1) {
        if (tried.has(i)) continue;
        if (!(positionalPayoffs[i] > 0)) continue; // also rejects NaN
        if (treatments[i].playerCount === 0) continue;
        if (treatments[i].playerCount > available.size) continue;
        pool.push(i);
      }
      if (pool.length === 0) break;

      const treatmentIdx =
        temperature === 0
          ? argmaxWithTiebreak(pool, positionalPayoffs, rng)
          : softmaxSample(pool, positionalPayoffs, temperature, rng);

      const filled = tryFillTreatment(
        treatmentIdx,
        treatments[treatmentIdx],
        available,
        eligibility,
        rng,
      );
      if (filled) {
        assignments.push({
          treatment: treatments[treatmentIdx],
          positionAssignments: filled,
        });
        for (const pa of filled) available.delete(pa.playerId);
        positionalPayoffs = applyKnockdown(positionalPayoffs, treatmentIdx);
        progress = true;
        break; // restart outer round so the next pick re-ranks
      }
      tried.add(treatmentIdx);
    }
    if (!progress) break;
  }

  const newPayoffs: LabeledScalars = {};
  for (let i = 0; i < n; i += 1) newPayoffs[names[i]] = positionalPayoffs[i];

  return { assignments, newState: { payoffs: newPayoffs } };
}

/** Argmax over `pool` (a subset of indices into `current`), with
 *  uniform-random tiebreak among indices at the max value. Sampling
 *  via the supplied rng keeps the algorithm deterministic for a given
 *  seed. */
function argmaxWithTiebreak(
  pool: number[],
  current: number[],
  rng: () => number,
): number {
  let maxValue = Number.NEGATIVE_INFINITY;
  const maxIndices: number[] = [];
  for (const i of pool) {
    const v = current[i];
    if (v > maxValue) {
      maxValue = v;
      maxIndices.length = 0;
      maxIndices.push(i);
    } else if (v === maxValue) {
      maxIndices.push(i);
    }
  }
  return maxIndices[Math.floor(rng() * maxIndices.length)];
}

/** Softmax `p[i] ∝ exp(current[i] / T)` over `pool`, with max-subtract
 *  for numerical stability. As `T → ∞`, `(current[i] - max) / T → 0`,
 *  every weight → 1, sampling → uniform over the pool. */
function softmaxSample(
  pool: number[],
  current: number[],
  T: number,
  rng: () => number,
): number {
  let maxPayoff = Number.NEGATIVE_INFINITY;
  for (const i of pool) {
    if (current[i] > maxPayoff) maxPayoff = current[i];
  }
  const weights: number[] = new Array<number>(pool.length);
  let totalWeight = 0;
  for (let k = 0; k < pool.length; k += 1) {
    const w = Math.exp((current[pool[k]] - maxPayoff) / T);
    weights[k] = w;
    totalWeight += w;
  }
  // Float fallback: if all weights underflow to zero (shouldn't happen
  // with max-subtract, but defensively), uniform-sample.
  if (!(totalWeight > 0)) {
    return pool[Math.floor(rng() * pool.length)];
  }
  const target = rng() * totalWeight;
  let cumulative = 0;
  for (let k = 0; k < pool.length; k += 1) {
    cumulative += weights[k];
    if (target < cumulative) return pool[k];
  }
  return pool[pool.length - 1];
}

/** Discriminate the four `knockdowns` shapes once at construction time
 *  and return a function that applies the post-pick update in-loop.
 *  Each returned function clones the input array (no in-place
 *  mutation) and produces the new payoff vector. */
function buildKnockdownApplier(
  knockdowns: number | LabeledScalars | LabeledMatrix | "none",
  names: string[],
): (current: number[], pickedIdx: number) => number[] {
  if (knockdowns === "none") {
    return (current) => current;
  }
  if (typeof knockdowns === "number") {
    const k = knockdowns;
    return (current, pickedIdx) =>
      current.map((p, i) => (i === pickedIdx ? p * k : p));
  }
  if (typeof knockdowns !== "object" || knockdowns === null) {
    throw new Error(
      `weightedKnockdown: knockdowns must be "none", a number, a labeled scalars object, or a labeled matrix; got ${typeof knockdowns}`,
    );
  }
  // Discriminate LabeledScalars vs LabeledMatrix by the type of the
  // first value, then validate uniform shape across all entries. The
  // top-level validator enforces this at config-time; the symmetric
  // runtime guards here are defense in depth for direct callers that
  // bypass validation (programmatic batch construction, host adapters,
  // tests). Mixed-shape / typo'd inputs throw a clear error here
  // instead of silently producing wrong knockdown semantics.
  const knockdownsRec = knockdowns as Record<string, unknown>;
  const firstKey = Object.keys(knockdownsRec)[0];
  if (firstKey === undefined) {
    throw new Error(
      `weightedKnockdown: knockdowns object is empty — expected labels matching the treatment name set`,
    );
  }
  const firstValue = knockdownsRec[firstKey];
  if (typeof firstValue === "number") {
    // LabeledScalars — verify every value is also a number (no mixed
    // shape) before reading.
    for (const [k, v] of Object.entries(knockdownsRec)) {
      if (typeof v !== "number") {
        throw new Error(
          `weightedKnockdown: knockdowns has mixed value types — "${firstKey}" is a number (labeled scalars) but "${k}" is ${typeof v}. Use uniform shape: all numbers (per-treatment self-decay) or all objects (matrix).`,
        );
      }
    }
    const scalars = knockdownsRec as LabeledScalars;
    validateLabelSet("weightedKnockdown", "knockdowns", scalars, names);
    const positionalFactors = names.map((name) => scalars[name]);
    return (current, pickedIdx) =>
      current.map((p, i) =>
        i === pickedIdx ? p * positionalFactors[pickedIdx] : p,
      );
  }
  if (typeof firstValue !== "object" || firstValue === null) {
    throw new Error(
      `weightedKnockdown: knockdowns values must be numbers (per-treatment self-decay) or objects (matrix); got ${typeof firstValue}`,
    );
  }
  // LabeledMatrix — verify every row is a non-array object and every
  // cell is a number before reading.
  for (const [rowName, row] of Object.entries(knockdownsRec)) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(
        `weightedKnockdown: knockdowns has mixed value types — "${firstKey}" is an object (matrix) but "${rowName}" is ${Array.isArray(row) ? "an array" : typeof row}. Use uniform shape: all numbers (per-treatment self-decay) or all objects (matrix).`,
      );
    }
    for (const [colName, v] of Object.entries(row as Record<string, unknown>)) {
      if (typeof v !== "number") {
        throw new Error(
          `weightedKnockdown: knockdowns["${rowName}"]["${colName}"] must be a number, got ${typeof v}`,
        );
      }
    }
  }
  const matrix = knockdownsRec as LabeledMatrix;
  // Strict literal — same rule as urn's decrements: every treatment
  // must have a row. Missing column entries within a present row
  // default to 1 (multiplicative identity, no decay on that column).
  validateLabelSet("weightedKnockdown", "knockdowns rows", matrix, names);
  // Pre-materialize rows as positional vectors so the inner loop is
  // cheap arithmetic, not string lookup. Missing columns default to 1.
  const positionalMatrix: number[][] = names.map((rowName) =>
    names.map((colName) => matrix[rowName][colName] ?? 1),
  );
  return (current, pickedIdx) => {
    const row = positionalMatrix[pickedIdx];
    return current.map((p, i) => p * row[i]);
  };
}
