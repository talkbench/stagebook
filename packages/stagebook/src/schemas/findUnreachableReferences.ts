import type { ZodIssue } from "zod";
import { z } from "zod";
import {
  STAGE_PRODUCED_REF_TYPES,
  collectStepKeys,
  collectKeysFromAny,
  collectProducedKeys,
  enumerateStepSites,
} from "./validateReferences.js";
import { getReferenceKeyAndPath } from "../utils/reference.js";
import { formatReference } from "./reference.js";

/**
 * Strict per-treatment reachable-keys reference check, applied to a
 * hydrated treatment file (templates expanded into their invocation
 * sites). Catches what the schema's existing reference checker
 * silently passes via its `globalProducedKeys` fallthrough:
 *
 *   - Cross-treatment leaks (producer in another treatment)
 *   - Producer in a template that this treatment doesn't invoke
 *   - Producer in a template another treatment invokes
 *
 * All three are runtime-equivalent (the consumer's participant never
 * traverses the producer) and collapse to a single diagnostic class —
 * "reference doesn't match any element in this treatment." No
 * prescriptive sub-message about which sub-case is involved; that
 * would risk mis-directing the fix.
 *
 * To avoid duplicating the schema's "unknown reference" diagnostic,
 * the check only emits when the reference IS produced somewhere in
 * the file (just not reachable from this treatment). Pure typos —
 * keys produced nowhere — are left to the schema's existing pass.
 *
 * Only sound on the HYDRATED form. Per-treatment producedAt on raw
 * source is incomplete (templates not expanded) and would false-
 * positive on legitimate template-injected references.
 *
 * See #321 for the broader pipeline; this is the rung-3-strict piece
 * the diff orchestrator calls.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function findUnreachableReferences(
  hydratedTreatmentFile: unknown,
): ZodIssue[] {
  if (!isRecord(hydratedTreatmentFile)) return [];

  const issues: ZodIssue[] = [];
  const introSequences = toArray(hydratedTreatmentFile.introSequences);
  const treatments = toArray(hydratedTreatmentFile.treatments);
  const templates = toArray(hydratedTreatmentFile.templates);

  // Intro keys are shared across treatments (every treatment can read
  // intro-phase data). Build once.
  const introProducedKeys = new Set<string>();
  for (const seq of introSequences) {
    if (!isRecord(seq)) continue;
    for (const step of toArray(seq.introSteps)) {
      collectProducedKeys(step, introProducedKeys);
    }
  }

  // globalProducedKeys: union over everything (incl. templates and
  // other treatments). Used to filter out pure typos so we don't
  // duplicate the schema's unknown-reference diagnostic.
  const globalProducedKeys = new Set<string>(introProducedKeys);
  for (const treatment of treatments) {
    if (!isRecord(treatment)) continue;
    for (const stage of toArray(treatment.gameStages)) {
      for (const key of collectStepKeys(stage)) globalProducedKeys.add(key);
    }
    for (const step of toArray(treatment.exitSequence)) {
      for (const key of collectStepKeys(step)) globalProducedKeys.add(key);
    }
  }
  for (const tmpl of templates) {
    if (!isRecord(tmpl)) continue;
    collectKeysFromAny(tmpl.content, globalProducedKeys);
  }

  // Per-treatment reachable check.
  treatments.forEach((treatment, treatmentIdx) => {
    if (!isRecord(treatment)) return;

    // Build this treatment's reachable keys: intro keys + own
    // gameStages + own exitSequence. (Templates have already been
    // expanded into the appropriate stages by hydration, so their
    // produced keys appear naturally in this treatment's stage walk.)
    const reachable = new Set<string>(introProducedKeys);
    const stages = toArray(treatment.gameStages);
    for (const stage of stages) {
      for (const key of collectStepKeys(stage)) reachable.add(key);
    }
    for (const step of toArray(treatment.exitSequence)) {
      for (const key of collectStepKeys(step)) reachable.add(key);
    }

    // Walk every reference site in this treatment's stages and exit
    // (intro sites belong to their own sequence scope, not the
    // treatment — they're validated by the intro-pass elsewhere).
    const allSites = [
      ...stages.flatMap((stage, stageIdx) =>
        enumerateStepSites(stage, [
          "treatments",
          treatmentIdx,
          "gameStages",
          stageIdx,
        ]),
      ),
      ...toArray(treatment.exitSequence).flatMap((step, stepIdx) =>
        enumerateStepSites(step, [
          "treatments",
          treatmentIdx,
          "exitSequence",
          stepIdx,
        ]),
      ),
    ];

    for (const site of allSites) {
      // External sources (entryUrl, participantInfo, …) always
      // resolve at runtime, no check needed.
      if (!STAGE_PRODUCED_REF_TYPES.has(site.reference.source)) continue;

      let referenceKey: string;
      try {
        ({ referenceKey } = getReferenceKeyAndPath(site.reference));
      } catch {
        // Malformed reference — schema's other validators handle it.
        continue;
      }

      // In this treatment's reachable set → schema's existing rank
      // check will validate forward-reference semantics. Nothing for
      // us to add.
      if (reachable.has(referenceKey)) continue;

      // Not produced anywhere in the file → schema's existing
      // unknown-reference check will flag it. Don't duplicate.
      if (!globalProducedKeys.has(referenceKey)) continue;

      // Produced somewhere in the file but not reachable from this
      // treatment. Real bug — emit.
      const refStr = formatReference(site.reference);
      issues.push({
        code: z.ZodIssueCode.custom,
        path: site.path,
        message: `Reference "${refStr}" doesn't match any element in this treatment. The storage key "${referenceKey}" exists elsewhere in the file (another treatment, or a template this treatment doesn't invoke), but participants only traverse one treatment's stages — references must resolve within the treatment that uses them.`,
      });
    }
  });

  return issues;
}
