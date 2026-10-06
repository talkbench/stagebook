/* eslint-disable @typescript-eslint/unbound-method */
import React, { useEffect, useRef } from "react";
import { useStagebookContext } from "../StagebookProvider.js";
import { evaluateConditions } from "../../utils/evaluateConditions.js";
import { Loading } from "../form/Loading.js";
import type {
  Condition,
  ConditionNode,
} from "./ConditionsConditionalRender.js";

export interface StageConditionGateProps {
  /**
   * Stage-level conditions from the treatment DSL (#183). When the
   * condition tree evaluates to `true`, children render normally;
   * when it evaluates to `false`, stagebook asks the host to advance
   * the stage via `context.advanceStage` (falling back to `submit`).
   *
   * Accepts the full #235 boolean-tree shape: a flat array (implicit
   * `all`), an `all`/`any`/`none` operator node, a single leaf, or
   * undefined (no gate).
   */
  conditions?: ConditionNode[] | ConditionNode;
  children: React.ReactNode;
}

// Re-export `Condition` for consumers that still type against the
// leaf-only form. Backward-compat — new code should use ConditionNode.
export type { Condition };

/**
 * Wraps a stage's render body and evaluates stage-level conditions.
 *
 * Two behaviors, same code path:
 * - **Skip at load.** Conditions reference data produced in *prior*
 *   stages. Evaluated on mount; if false, stagebook immediately asks
 *   the host to advance. Stage body never renders.
 * - **Early termination.** Conditions reference data in the *current*
 *   stage, authored so they evaluate to `true` when the value is
 *   Missing (typically `comparator: doesNotExist`). Stage renders
 *   normally; when a value arrives that flips a condition to false,
 *   stagebook asks the host to advance.
 *
 * Advance is fired at most once per stage:
 * - A latch ref prevents double-fire within a stage.
 * - The latch auto-resets when the stage identity changes (via
 *   `stageId` if the host supplies one, or the conditions array
 *   reference otherwise) so the next stage starts clean — hosts that
 *   reuse the provider across stages don't need to key-remount.
 */
export function StageConditionGate({
  conditions,
  children,
}: StageConditionGateProps) {
  const {
    readReference,
    onContractViolation,
    violationKeys,
    advanceStage,
    submit,
    stageId,
  } = useStagebookContext();

  // Reset the advance latch whenever the stage changes. Tracks
  // `stageId` when the host supplies one (authoritative identity),
  // otherwise falls back to the conditions array reference (changes
  // each time the stage config changes in a well-behaved host).
  const stageKey = stageId ?? conditions;
  const lastStageKeyRef = useRef<unknown>(null);
  const advanceFiredRef = useRef(false);
  if (lastStageKeyRef.current !== stageKey) {
    lastStageKeyRef.current = stageKey;
    advanceFiredRef.current = false;
  }

  // Only an omitted field means no gate. Invalid empty/null slots are
  // rejected by authoring validation and do not become unconditional here.
  const hasConditions = conditions !== undefined;
  const allMet = evaluateConditions(conditions, {
    readReference,
    onViolation: onContractViolation,
    violationKeys,
  });

  useEffect(() => {
    if (!hasConditions) return;
    if (allMet) return;
    if (advanceFiredRef.current) return;
    advanceFiredRef.current = true;

    if (advanceStage) {
      advanceStage();
    } else {
      warnFallbackOnce();
      submit();
    }
    // `stageKey` in deps: without it, two consecutive stages that both
    // fail conditions wouldn't re-fire the effect, because `allMet`
    // stays `false` across the transition and no other dep changes.
    // The in-render latch reset covers the latch, but the effect also
    // needs to be woken up for the new stage.
  }, [hasConditions, allMet, advanceStage, submit, stageKey]);

  if (!hasConditions || allMet) return <>{children}</>;

  return (
    <div
      data-testid="stage-condition-gate"
      data-state="advancing"
      style={{ textAlign: "center" }}
    >
      <Loading />
    </div>
  );
}

let warned = false;
function warnFallbackOnce(): void {
  if (warned) return;
  warned = true;
  // `console.debug` rather than `console.warn`: the fallback is a
  // legitimate choice for single-participant hosts that don't need
  // cross-client advancement, and we don't want to spam those hosts'
  // production logs. Browsers hide `.debug` by default but surface it
  // at the Verbose log level for hosts investigating stage behavior.
  console.debug(
    "[stagebook] StagebookContext.advanceStage is not implemented; " +
      "falling back to submit() for stage-level condition advancement. " +
      "Multi-participant hosts should implement advanceStage to submit " +
      "for every player so dropouts don't hang the stage. See #183.",
  );
}
