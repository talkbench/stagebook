/**
 * Shared walk for element lints that run outside the schema (#536, #723).
 *
 * Visits every element in each container a participant can traverse: treatment
 * game stages and exit sequences, intro-sequence steps, and consent-arm steps.
 * Like `collectStorageKeyCollisions` it deliberately does NOT scan `templates:`
 * bodies: a template-provided element is linted once it lands in a real stage,
 * on the expanded pass. Defensive against malformed input: non-record elements
 * and containers are skipped.
 */

export type ElementPath = (string | number)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Visit = (element: Record<string, unknown>, path: ElementPath) => void;

function visitStageList(stages: unknown, basePath: ElementPath, visit: Visit) {
  if (!Array.isArray(stages)) return;
  stages.forEach((stage, stageIdx) => {
    if (!isRecord(stage) || !Array.isArray(stage.elements)) return;
    stage.elements.forEach((el, idx) => {
      if (isRecord(el)) visit(el, [...basePath, stageIdx, "elements", idx]);
    });
  });
}

export function forEachConcreteElement(data: unknown, visit: Visit): void {
  if (!isRecord(data)) return;

  if (Array.isArray(data.treatments)) {
    data.treatments.forEach((treatment, tIdx) => {
      if (!isRecord(treatment)) return;
      visitStageList(
        treatment.gameStages,
        ["treatments", tIdx, "gameStages"],
        visit,
      );
      visitStageList(
        treatment.exitSequence,
        ["treatments", tIdx, "exitSequence"],
        visit,
      );
    });
  }

  if (Array.isArray(data.introSequences)) {
    data.introSequences.forEach((seq, seqIdx) => {
      if (!isRecord(seq)) return;
      visitStageList(
        seq.introSteps,
        ["introSequences", seqIdx, "introSteps"],
        visit,
      );
    });
  }

  if (Array.isArray(data.consent)) {
    data.consent.forEach((arm, armIdx) => {
      if (!isRecord(arm)) return;
      visitStageList(arm.steps, ["consent", armIdx, "steps"], visit);
    });
  }
}
