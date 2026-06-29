import type { ElementType, DiscussionType, ConditionType } from "stagebook";

export type Phase = "intro" | "game" | "exit";

export interface ViewerStep {
  index: number;
  phase: Phase;
  name: string;
  elements: ElementType[];
  duration?: number;
  discussion?: DiscussionType;
  /** Researcher-facing notes on the stage (never shown to participants). */
  notes?: string;
  /** Stage-level conditions (#183). Evaluated by StageConditionGate. */
  conditions?: ConditionType[];
}

interface IntroSequence {
  name: string;
  locale?: string;
  introSteps: {
    name: string;
    notes?: string;
    conditions?: ConditionType[];
    elements: ElementType[];
  }[];
}

interface Treatment {
  name: string;
  locale?: string;
  playerCount: number;
  gameStages: {
    name: string;
    notes?: string;
    conditions?: ConditionType[];
    duration?: number;
    elements: ElementType[];
    discussion?: DiscussionType;
  }[];
  exitSequence?: {
    name: string;
    notes?: string;
    conditions?: ConditionType[];
    elements: ElementType[];
  }[];
}

/**
 * The participant-facing locale for a given phase. Intro steps render under
 * the intro sequence's declared locale (intro runs before treatment
 * assignment, so it carries its own); game + exit steps under the treatment's.
 * Both default to English. Which locale a real participant sees is the host's
 * assignment decision — this just reports what each phase declares.
 */
export function localeForPhase(
  phase: Phase | undefined,
  introSequence: { locale?: string } | undefined,
  treatment: { locale?: string },
): string {
  if (phase === "intro") return introSequence?.locale ?? "en";
  return treatment.locale ?? "en";
}

/**
 * Flatten a selected intro sequence and treatment into a single
 * ordered list of steps the viewer can navigate.
 *
 * `introSequence` is optional: a treatment file may declare only
 * `treatments:` (no `introSequences:`), in which case the walkthrough
 * starts at the first game stage.
 */
export function flattenSteps(
  introSequence: IntroSequence | undefined,
  treatment: Treatment,
): ViewerStep[] {
  let index = 0;
  const steps: ViewerStep[] = [];

  for (const step of introSequence?.introSteps ?? []) {
    steps.push({
      index: index++,
      phase: "intro",
      name: step.name,
      elements: step.elements,
      notes: step.notes,
      conditions: step.conditions,
    });
  }

  for (const stage of treatment.gameStages) {
    steps.push({
      index: index++,
      phase: "game",
      name: stage.name,
      elements: stage.elements,
      duration: stage.duration,
      discussion: stage.discussion,
      notes: stage.notes,
      conditions: stage.conditions,
    });
  }

  if (treatment.exitSequence) {
    for (const step of treatment.exitSequence) {
      steps.push({
        index: index++,
        phase: "exit",
        name: step.name,
        elements: step.elements,
        notes: step.notes,
        conditions: step.conditions,
      });
    }
  }

  return steps;
}
