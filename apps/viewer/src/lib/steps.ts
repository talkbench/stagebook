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
  /** When true, this is a synthetic end-of-unit interstitial (not a real
   *  stage): the viewer renders `transitionCopy` instead of a `<Stage>`. It
   *  narrates the platform behavior between phases (assignment, lobby, etc.)
   *  that the preview can't simulate. */
  isTransition?: boolean;
  transitionCopy?: string;
}

/**
 * A separately-selectable unit of a study: one intro sequence OR one
 * treatment. The viewer walks **one unit at a time** (rather than pairing an
 * intro with a treatment), which matches how researchers author each phase
 * independently — and removes any which-intro-goes-with-which-treatment
 * pairing logic. Each unit carries its own locale (intro sequences run before
 * treatment assignment, so they declare their own).
 */
export interface ViewerUnit {
  /** Stable key, e.g. `intro:0` / `treatment:1`. */
  key: string;
  kind: "intro" | "treatment";
  name: string;
  locale: string;
  /** Participant count for the inspector; 1 for intro (pre-assignment). */
  playerCount: number;
  /** The unit's own stages, plus a trailing synthetic transition step. */
  steps: ViewerStep[];
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

interface TreatmentFileShape {
  introSequences?: IntroSequence[];
  treatments?: Treatment[];
}

function transitionStep(
  index: number,
  kind: "intro" | "treatment",
  name: string,
  opts: { hasPicker: boolean; hasTreatmentToPreview: boolean },
): ViewerStep {
  // Narrate the platform's between-phase behavior the preview can't simulate.
  // Only point at "the picker above" when one actually exists (2+ units) and,
  // for an intro, only mention previewing a treatment when one exists — a
  // single-unit or intro-only preview has no such control/target (#485 review).
  const base =
    kind === "intro"
      ? `End of the intro sequence “${name}”. In a real study, participants are now assigned to a condition and matched into a group.`
      : `End of “${name}”. In a real study, participants would now finish the session (and complete any debrief).`;
  let hint = "";
  if (kind === "intro" && opts.hasPicker && opts.hasTreatmentToPreview) {
    hint = " Use the picker above to preview a treatment.";
  } else if (kind === "treatment" && opts.hasPicker) {
    hint = " Use the picker above to preview another part.";
  }
  return {
    index,
    phase: kind === "intro" ? "intro" : "exit",
    name: "→ transition",
    elements: [],
    isTransition: true,
    transitionCopy: base + hint,
  };
}

/**
 * Build the flat list of separately-selectable units (each intro sequence and
 * each treatment), in picker order. Each unit's steps are its own stages plus
 * a trailing transition interstitial. A treatment-only file yields only
 * treatment units; an intro-only file only intro units.
 */
export function buildUnits(treatmentFile: TreatmentFileShape): ViewerUnit[] {
  const units: ViewerUnit[] = [];
  const introSequences = treatmentFile.introSequences ?? [];
  const treatments = treatmentFile.treatments ?? [];
  // A picker only renders when there's more than one unit to switch between.
  const hasPicker = introSequences.length + treatments.length > 1;
  const hasTreatmentToPreview = treatments.length > 0;

  introSequences.forEach((seq, i) => {
    let index = 0;
    const steps: ViewerStep[] = (seq.introSteps ?? []).map((step) => ({
      index: index++,
      phase: "intro" as const,
      name: step.name,
      elements: step.elements,
      notes: step.notes,
      conditions: step.conditions,
    }));
    steps.push(
      transitionStep(index, "intro", seq.name, {
        hasPicker,
        hasTreatmentToPreview,
      }),
    );
    units.push({
      key: `intro:${i}`,
      kind: "intro",
      name: seq.name,
      locale: seq.locale ?? "en",
      playerCount: 1,
      steps,
    });
  });

  treatments.forEach((t, i) => {
    const steps = flattenSteps(undefined, t);
    steps.push(
      transitionStep(steps.length, "treatment", t.name, {
        hasPicker,
        hasTreatmentToPreview,
      }),
    );
    units.push({
      key: `treatment:${i}`,
      kind: "treatment",
      name: t.name,
      locale: t.locale ?? "en",
      playerCount: t.playerCount,
      steps,
    });
  });

  return units;
}

/**
 * The unit the viewer should open on, given the host's landing selection.
 * Prefers the selected treatment (the walk-one-unit default — intros are
 * reachable via the picker); falls back to the selected intro when no matching
 * treatment exists (e.g. an intro-only file, or a multi-intro file where the
 * overview picked the second intro — #485 review); finally to the first unit.
 */
export function initialUnitKey(
  units: ViewerUnit[],
  introIndex: number,
  treatmentIndex: number,
): string {
  const wantTreatment = `treatment:${treatmentIndex}`;
  if (units.some((u) => u.key === wantTreatment)) return wantTreatment;
  const wantIntro = `intro:${introIndex}`;
  if (units.some((u) => u.key === wantIntro)) return wantIntro;
  return units[0]?.key ?? wantTreatment;
}
