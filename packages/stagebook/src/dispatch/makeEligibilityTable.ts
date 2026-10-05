import { getNestedValueByPath } from "../utils/reference.js";
import { eligibilityReference } from "./eligibilityReference.js";
import {
  evaluateConditions,
  type Condition,
  type ConditionNode,
} from "../utils/evaluateConditions.js";
import type {
  DispatchConditionNode,
  EligibilityTable,
  PlayerDataSnapshot,
  Treatment,
} from "./types.js";

interface MakeEligibilityTableArgs {
  playerIds: string[];
  treatments: Treatment[];
  /** Per-player storage-key map. Keys come from `extractConditionKeys`. */
  playerData: PlayerDataSnapshot;
}

/**
 * Build a `(playerId, treatmentIndex, position) → boolean` lookup once
 * per dispatch tick. The host has already fetched each candidate's data
 * for the storage-keys returned by `extractConditionKeys`; here we run
 * the same condition-tree evaluator stagebook uses elsewhere
 * (`evaluateConditions`) against the candidate's data, and cache the
 * answer.
 *
 * Only `self.X.Y` references are resolved — eligibility is a per-
 * candidate question, and numeric/`shared`/`all` selectors would
 * require the eventual group composition (a circular dependency). Those
 * reads return `undefined` from the resolve callback, which the tri-
 * state evaluator collapses to "data not yet" → false at the boundary.
 * Treatments without `groupComposition`, and slots without
 * `conditions`, are unconstrained (everyone eligible).
 *
 * The returned table is read-only. The dispatcher consumes it strictly
 * through `isEligible(...)` and never inspects the underlying data.
 */
export function makeEligibilityTable({
  playerIds,
  treatments,
  playerData,
}: MakeEligibilityTableArgs): EligibilityTable {
  // Map<playerId, Map<treatmentIndex, Map<position, bool>>>.
  // A nested map (rather than a flat string-keyed cache) keeps the
  // membership probes O(1) without the GC pressure of building one
  // composite string per (player, treatment, position) tuple.
  const cache = new Map<string, Map<number, Map<number, boolean>>>();

  for (const pid of playerIds) {
    const dataForPlayer = playerData[pid] ?? {};
    const resolveForPlayer = (reference: unknown): unknown[] => {
      // Eligibility resolves only `self.*` references. Anything else
      // collapses to "no values resolved" — the tri-state leaf
      // evaluator then returns false (positive comparators) or true
      // (`doesNotEqual` family) per `compare`'s undefined-lhs policy.
      const parsed = eligibilityReference(reference);
      if (!parsed) return [];
      const { referenceKey, path } = parsed;
      const record = dataForPlayer[referenceKey];
      if (record === undefined) return [];
      const value = getNestedValueByPath(record, path);
      if (value === undefined) return [];
      return [value];
    };

    const treatmentMap = new Map<number, Map<number, boolean>>();
    cache.set(pid, treatmentMap);

    treatments.forEach((treatment, treatmentIdx) => {
      const positionMap = new Map<number, boolean>();
      treatmentMap.set(treatmentIdx, positionMap);
      const gc = treatment.groupComposition;
      for (let pos = 0; pos < treatment.playerCount; pos += 1) {
        let conditions:
          | DispatchConditionNode
          | DispatchConditionNode[]
          | undefined;
        if (Array.isArray(gc)) {
          const slot = gc.find((s) => s?.position === pos);
          conditions = slot?.conditions;
        }
        if (conditions === undefined || conditions === null) {
          positionMap.set(pos, true);
          continue;
        }
        const ok = evaluateConditions(
          conditions as ConditionNode | ConditionNode[] | Condition,
          resolveForPlayer,
        );
        positionMap.set(pos, ok);
      }
    });
  }

  return {
    isEligible(playerId, treatmentIndex, position) {
      return cache.get(playerId)?.get(treatmentIndex)?.get(position) ?? false;
    },
  };
}
