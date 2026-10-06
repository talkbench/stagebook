import { Missing } from "../expressions/missing.js";
import type {
  ExpressionReference,
  ExpressionTypeViolation,
} from "../expressions/evaluateExpression.js";
import { readReference } from "../utils/readReference.js";
import { eligibilityReference } from "./eligibilityReference.js";
import { evaluateConditions } from "../utils/evaluateConditions.js";
import type {
  DispatchConditionNode,
  EligibilityTable,
  PlayerDataSnapshot,
  Treatment,
} from "./types.js";

export interface MakeEligibilityTableArgs {
  playerIds: string[];
  treatments: Treatment[];
  /** Per-player storage-key map. Keys come from `extractConditionKeys`. */
  playerData: PlayerDataSnapshot;
  /** Sanitized reference/type diagnostics; participant answers are omitted. */
  onViolation?: (violation: ExpressionTypeViolation) => void;
  /** Retain across ticks to deduplicate the same reference/type mismatch.
   * By default reports are deduplicated across this tick's whole table. */
  violationKeys?: Set<string>;
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
 * candidate question, and numeric/`shared`/`everyone` selectors would
 * require the eventual group composition (a circular dependency). Those
 * reads return Missing. They cannot match a positive comparator; negative
 * comparisons and explicitly authored fallbacks follow ordinary Missing
 * semantics. Authoring validation rejects non-self eligibility references.
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
  onViolation,
  violationKeys = new Set<string>(),
}: MakeEligibilityTableArgs): EligibilityTable {
  // Map<playerId, Map<treatmentIndex, Map<position, bool>>>.
  // A nested map (rather than a flat string-keyed cache) keeps the
  // membership probes O(1) without the GC pressure of building one
  // composite string per (player, treatment, position) tuple.
  const cache = new Map<string, Map<number, Map<number, boolean>>>();

  for (const pid of playerIds) {
    const dataForPlayer =
      (Object.prototype.hasOwnProperty.call(playerData, pid)
        ? playerData[pid]
        : undefined) ?? {};
    const readForPlayer = (reference: ExpressionReference): unknown => {
      const parsed = eligibilityReference(reference);
      if (!parsed) return Missing;
      return readReference(reference, (key) =>
        Object.prototype.hasOwnProperty.call(dataForPlayer, key)
          ? [dataForPlayer[key]]
          : [],
      );
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
        if (conditions === undefined) {
          positionMap.set(pos, true);
          continue;
        }
        const ok = evaluateConditions(conditions, {
          readReference: readForPlayer,
          onViolation,
          violationKeys,
        });
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
