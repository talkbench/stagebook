import type {
  ElementType,
  ResolvedDiscussionType,
  ConditionType,
} from "../../schemas/index.js";

export type Phase = "consent" | "intro" | "game" | "exit";

export interface ViewerStep {
  index: number;
  phase: Phase;
  name: string;
  elements: ElementType[];
  duration?: number;
  discussion?: ResolvedDiscussionType;
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
 * A separately-selectable unit of a study: one consent arm, one intro
 * sequence, OR one treatment. The viewer walks **one unit at a time** (rather
 * than pairing an intro with a treatment), which matches how researchers
 * author each phase independently — and removes any
 * which-intro-goes-with-which-treatment pairing logic. Each unit carries its
 * own locale (consent arms and intro sequences run before treatment
 * assignment, so they declare their own).
 */
export interface ViewerUnit {
  /** Stable key, e.g. `consent:0` / `intro:0` / `treatment:1`. */
  key: string;
  kind: "consent" | "intro" | "treatment";
  name: string;
  locale: string;
  /** Participant count for the inspector; 1 for consent/intro
   *  (pre-assignment). */
  playerCount: number;
  /** The unit's own stages, plus a trailing synthetic transition step. */
  steps: ViewerStep[];
}

/** The shared per-participant step shape (consent/intro/exit). */
interface StepShape {
  name: string;
  notes?: string;
  conditions?: ConditionType[];
  elements: ElementType[];
}

interface ConsentArm {
  name: string;
  locale?: string;
  steps: StepShape[];
}

interface IntroSequence {
  name: string;
  locale?: string;
  introSteps: StepShape[];
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
    discussion?: ResolvedDiscussionType;
  }[];
  exitSequence?: StepShape[];
}

/**
 * The participant-facing locale for a given phase. Consent steps render under
 * the consent arm's declared locale and intro steps under the intro
 * sequence's (both run before treatment assignment, so they carry their own);
 * game + exit steps under the treatment's. All default to English.
 * Which locale a real participant sees is the host's assignment decision —
 * this just reports what each phase declares.
 */
export function localeForPhase(
  phase: Phase | undefined,
  consentArm: { locale?: string } | undefined,
  introSequence: { locale?: string } | undefined,
  treatment: { locale?: string },
): string {
  if (phase === "consent") return consentArm?.locale ?? "en";
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
  consent?: ConsentArm[];
  introSequences?: IntroSequence[];
  treatments?: Treatment[];
}

function transitionStep(
  index: number,
  kind: "consent" | "intro" | "treatment",
  name: string,
  opts: {
    hasPicker: boolean;
    hasIntroToPreview: boolean;
    hasTreatmentToPreview: boolean;
  },
): ViewerStep {
  // Narrate the platform's between-phase behavior the preview can't simulate.
  // Only point at "the picker above" when one actually exists (2+ units) and
  // only mention previewing a specific next part when one exists — a
  // single-unit or intro-only preview has no such control/target (#485 review).
  let base: string;
  if (kind === "consent") {
    base = `End of the consent arm “${name}”. In a real study, participants now complete attention and equipment checks, then begin the intro sequence.`;
  } else if (kind === "intro") {
    base = `End of the intro sequence “${name}”. In a real study, participants are now assigned to a condition and matched into a group.`;
  } else {
    base = `End of “${name}”. In a real study, the platform now runs quality checks and issues the participant’s completion code.`;
  }
  let hint = "";
  if (kind === "consent" && opts.hasPicker) {
    hint = opts.hasIntroToPreview
      ? " Use the picker above to preview an intro sequence."
      : " Use the picker above to preview another part.";
  } else if (kind === "intro" && opts.hasPicker && opts.hasTreatmentToPreview) {
    hint = " Use the picker above to preview a treatment.";
  } else if (kind === "treatment" && opts.hasPicker) {
    hint = " Use the picker above to preview another part.";
  }
  let phase: Phase;
  if (kind === "consent") phase = "consent";
  else if (kind === "intro") phase = "intro";
  else phase = "exit";
  return {
    index,
    phase,
    name: "→ transition",
    elements: [],
    isTransition: true,
    transitionCopy: base + hint,
  };
}

/**
 * Build the flat list of separately-selectable units (each consent arm, intro
 * sequence, and treatment), in picker order. Each unit's steps are its own
 * stages plus a trailing transition interstitial. A treatment-only file
 * yields only treatment units; an intro-only file only intro units.
 */
export function buildUnits(treatmentFile: TreatmentFileShape): ViewerUnit[] {
  const units: ViewerUnit[] = [];
  const consentArms = treatmentFile.consent ?? [];
  const introSequences = treatmentFile.introSequences ?? [];
  const treatments = treatmentFile.treatments ?? [];
  // A picker only renders when there's more than one unit to switch between.
  const hasPicker =
    consentArms.length + introSequences.length + treatments.length > 1;
  const hasIntroToPreview = introSequences.length > 0;
  const hasTreatmentToPreview = treatments.length > 0;

  // Consent runs before everything in a real study, so consent arms lead
  // the picker order (#481).
  consentArms.forEach((arm, i) => {
    let index = 0;
    const steps: ViewerStep[] = (arm.steps ?? []).map((step) => ({
      index: index++,
      phase: "consent" as const,
      name: step.name,
      elements: step.elements,
      notes: step.notes,
      conditions: step.conditions,
    }));
    steps.push(
      transitionStep(index, "consent", arm.name, {
        hasPicker,
        hasIntroToPreview,
        hasTreatmentToPreview,
      }),
    );
    units.push({
      key: `consent:${i}`,
      kind: "consent",
      name: arm.name,
      locale: arm.locale ?? "en",
      playerCount: 1,
      steps,
    });
  });

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
        hasIntroToPreview,
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
    // The exit sequence's trailing steps ARE the debrief (#481): they render
    // inline, and the end-of-treatment transition narrates the platform's
    // quality checks + completion code, which follow the exit sequence.
    const steps = flattenSteps(undefined, t);
    steps.push(
      transitionStep(steps.length, "treatment", t.name, {
        hasPicker,
        hasIntroToPreview,
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
