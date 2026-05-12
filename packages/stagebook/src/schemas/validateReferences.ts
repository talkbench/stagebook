/**
 * Cross-stage reference validation for treatment files (#197).
 *
 * Two rules:
 * 1. **No forward references** — applies to every reference site. A reference
 *    whose target storage key is produced by a *later* stage in the flow is
 *    rejected. External references (entryUrl, participantInfo, …) are
 *    always valid.
 * 2. **No always-skip-at-load** — stage-level conditions only. A stage-level
 *    condition whose reference points at the *current* stage's data and
 *    whose `compare(undefined, comparator, value)` is not strictly `true`
 *    will always skip the stage at mount. Rejected with a suggestion to
 *    rethink the comparator (usually a forgotten `doesNotExist`).
 *
 * Only stage-level conditions get Rule 2 because element-level, display,
 * urlParam, discussion, and groupComposition references all have a
 * well-defined "wait for data" semantics: element not rendered, display
 * empty, urlParam omitted, discussion hidden, no player match. None of
 * those are fatal the way a stage-level always-skip is.
 */

import { getReferenceKeyAndPath } from "../utils/reference.js";
import { compare, type Comparator } from "../utils/compare.js";
// `OPERATOR_KEYS` is in its own module to avoid a `treatment.ts ↔
// validateReferences.ts` import cycle. The reference helpers below come
// from `./reference.ts` for the same reason.
import { OPERATOR_KEYS } from "./conditionOperators.js";
import {
  parseDottedReference,
  formatReference,
  type ReferenceType,
} from "./reference.js";

/** Normalize a raw reference value (string or structured) into the
 *  structured form. Returns null if the input is malformed — callers skip
 *  malformed refs since they're a different class of error (caught by
 *  schema validation, not the walker).
 */
function normalizeReference(input: unknown): ReferenceType | null {
  if (typeof input === "string") {
    const parsed = parseDottedReference(input);
    return parsed.ok ? parsed.value : null;
  }
  if (input && typeof input === "object" && "source" in input) {
    return input as ReferenceType;
  }
  return null;
}

/** Structured issue emitted by the walker. Translated to zod issues by the
 *  caller. `path` is relative to the top-level treatment file. */
export interface ReferenceValidationIssue {
  path: (string | number)[];
  message: string;
}

/** Discriminator for which rules apply at a given reference site. */
type ReferenceKind =
  | "stageCondition"
  | "elementCondition"
  | "displayReference"
  | "urlParam"
  | "discussionCondition"
  | "groupComposition";

/** Ranks for the linear "who runs first" order within a single treatment.
 *  groupComposition < intro < gameStage[0] < … < gameStage[n] < exit[0] …
 *  Intro is collapsed to a single rank because intro sequences are
 *  interchangeable (a treatment can pair with any of them at runtime).
 *  Within-intro-sequence ordering is validated separately per sequence. */
const RANK_GROUP_COMPOSITION = -1;
const RANK_INTRO = 0;
const RANK_GAME_BASE = 1;

/** The types of reference whose target keys are **produced by a stage**. A
 *  reference of any other type (entryUrl, participantInfo, …) is external
 *  and always valid regardless of position.
 *
 *  Note: `discussion` references aren't in this set because stagebook
 *  doesn't model discussion storage keys — their shape depends on the
 *  host's runtime conventions (Tajriba attributes, chat transcript
 *  layout, …). We leave `discussion.*` refs alone rather than risk a
 *  false-positive "doesn't match any discussion element" on valid
 *  references. Forward-ref and unknown-ref checks both skip them. */
const STAGE_PRODUCED_REF_TYPES = new Set([
  "prompt",
  "survey",
  "submitButton",
  "qualtrics",
  "timeline",
  "trackedLink",
]);

/**
 * Walk a `conditions:` value (#235) and yield each leaf condition with
 * its absolute path. Handles all three shapes the boolean tree accepts:
 *
 *   - Array (sugar for implicit `all`): yields each child's leaves with
 *     the array index in the path.
 *   - Operator object (`{all|any|none: [...]}`): recurses into the
 *     children, scoping the path with the operator key + child index.
 *   - Leaf (anything with `comparator`, or a non-operator/template
 *     object): yields itself.
 *
 * Template invocations (`{template: ...}`) are skipped — content
 * unknown until expansion. The walker is "best-effort" because it
 * runs pre-validation (`superRefine` input is partially-valid), so
 * malformed shapes are silently dropped rather than throwing.
 */
function* walkConditionLeaves(
  conditions: unknown,
  pathPrefix: (string | number)[],
): Generator<{ leaf: Record<string, unknown>; path: (string | number)[] }> {
  if (conditions === undefined || conditions === null) return;

  if (Array.isArray(conditions)) {
    for (let i = 0; i < conditions.length; i++) {
      yield* walkConditionLeaves(conditions[i], [...pathPrefix, i]);
    }
    return;
  }

  if (!isRecord(conditions)) return;
  const node = conditions;

  for (const op of OPERATOR_KEYS) {
    const children = node[op];
    if (Array.isArray(children)) {
      for (let i = 0; i < children.length; i++) {
        yield* walkConditionLeaves(children[i], [...pathPrefix, op, i]);
      }
      return;
    }
  }

  // Template invocation — skip until expansion.
  if ("template" in node) return;

  yield { leaf: node, path: pathPrefix };
}

/**
 * Main entrypoint — given a parsed treatment-file tree, walks every reference
 * site and returns validation issues. Accepts `unknown` because the walker
 * runs pre-validation (zod `superRefine`'s input is partially-valid).
 */
export function validateTreatmentFileReferences(
  treatmentFile: unknown,
): ReferenceValidationIssue[] {
  const issues: ReferenceValidationIssue[] = [];
  if (!isRecord(treatmentFile)) return issues;

  const introSequences = toArray(treatmentFile.introSequences);
  const treatments = toArray(treatmentFile.treatments);

  // Build the set of keys produced by any game stage or exit step across
  // all treatments. Intro-step references to any of these are forward
  // references (intro always runs before game/exit). Passed to
  // validateStepSequence so intro validation catches the cross-phase case
  // even though intros don't otherwise know about game/exit data.
  const laterPhaseKeys = new Set<string>();
  for (const treatment of treatments) {
    if (!isRecord(treatment)) continue;
    for (const stage of toArray(treatment.gameStages)) {
      for (const key of collectStepKeys(stage)) laterPhaseKeys.add(key);
    }
    for (const step of toArray(treatment.exitSequence)) {
      for (const key of collectStepKeys(step)) laterPhaseKeys.add(key);
    }
  }

  // Intro-phase produced keys — merged across every intro sequence. Game
  // stages and exit steps are allowed to reference any intro-phase key.
  //
  // `collectStepKeys` iterates a step's elements; `collectProducedKeys`
  // operates on a single element and skips anything that isn't an
  // element. Passing a step to `collectProducedKeys` was a pre-existing
  // bug (#321 follow-up) that left this set empty — the result was
  // silently masked by a `globalProducedKeys` fallthrough that's been
  // removed (strict-by-default). Intro keys now flow correctly.
  const introProducedKeys = new Set<string>();
  for (const seq of introSequences) {
    if (!isRecord(seq)) continue;
    for (const step of toArray(seq.introSteps)) {
      for (const key of collectStepKeys(step)) introProducedKeys.add(key);
    }
  }

  // Intro sequences: validate each sequence in isolation for within-sequence
  // forward references, cross-phase forward references into game/exit, and
  // stage-level always-skip.
  introSequences.forEach((seq, seqIdx) => {
    if (!isRecord(seq)) return;
    const steps = toArray(seq.introSteps);
    validateStepSequence({
      steps,
      sequencePath: ["introSequences", seqIdx, "introSteps"],
      phase: "intro",
      issues,
      laterPhaseKeys,
    });
  });

  // Each treatment has its own game/exit rank space.
  treatments.forEach((treatment, treatmentIdx) => {
    if (!isRecord(treatment)) return;
    validateTreatment({
      treatment,
      treatmentPath: ["treatments", treatmentIdx],
      introProducedKeys,
      issues,
    });
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Per-sequence (intro or exit) and per-treatment walkers
// ---------------------------------------------------------------------------

/** Validate a linear sequence of steps (intro sequence). Each step has its
 *  own rank within the sequence; later steps can reference earlier steps. */
function validateStepSequence({
  steps,
  sequencePath,
  phase,
  issues,
  priorPhaseKeys,
  laterPhaseKeys,
}: {
  steps: unknown[];
  sequencePath: (string | number)[];
  phase: "intro" | "exit";
  issues: ReferenceValidationIssue[];
  /** Keys produced by earlier phases (for exit sequences: intro + game). */
  priorPhaseKeys?: Set<string>;
  /** Keys produced by later phases. Any intro-step reference to one of
   *  these is a cross-phase forward reference. */
  laterPhaseKeys?: Set<string>;
}): void {
  // Build producedAt: key → earliest step index that produces it.
  const producedAt = new Map<string, number>();
  steps.forEach((step, stepIdx) => {
    for (const key of collectStepKeys(step)) {
      if (!producedAt.has(key)) producedAt.set(key, stepIdx);
    }
  });

  steps.forEach((step, stepIdx) => {
    if (!isRecord(step)) return;
    const sites = enumerateStepSites(step, [...sequencePath, stepIdx]);
    for (const site of sites) {
      applyRules({
        site,
        enclosingRank: stepIdx,
        producedAt,
        issues,
        priorPhaseKeys,
        laterPhaseKeys,
        phaseLabel: phase === "intro" ? "intro step" : "exit step",
      });
    }
  });
}

function validateTreatment({
  treatment,
  treatmentPath,
  introProducedKeys,
  issues,
}: {
  treatment: Record<string, unknown>;
  treatmentPath: (string | number)[];
  introProducedKeys: Set<string>;
  issues: ReferenceValidationIssue[];
}): void {
  const gameStages = toArray(treatment.gameStages);
  const exitSequence = toArray(treatment.exitSequence);

  // Per-treatment ranks: game stages 1..K, exit entries K+1…. Intro sits
  // at a single virtual rank (RANK_INTRO) before game stages; its produced
  // keys are in `introProducedKeys` and treated as "always earlier."
  const producedAt = new Map<string, number>();
  // Pre-seed intro keys at RANK_INTRO so forward comparisons always place
  // them before any game/exit rank.
  for (const key of introProducedKeys) {
    if (!producedAt.has(key)) producedAt.set(key, RANK_INTRO);
  }
  gameStages.forEach((stage, idx) => {
    for (const key of collectStepKeys(stage)) {
      if (!producedAt.has(key)) producedAt.set(key, RANK_GAME_BASE + idx);
    }
  });
  exitSequence.forEach((step, idx) => {
    for (const key of collectStepKeys(step)) {
      if (!producedAt.has(key))
        producedAt.set(key, RANK_GAME_BASE + gameStages.length + idx);
    }
  });

  // groupComposition runs before any stage — can only reference intro +
  // external.
  const groupComposition = toArray(treatment.groupComposition);
  groupComposition.forEach((player, playerIdx) => {
    if (!isRecord(player)) return;
    const conditionsBase = [
      ...treatmentPath,
      "groupComposition",
      playerIdx,
      "conditions",
    ];
    for (const { leaf, path } of walkConditionLeaves(
      player.conditions,
      conditionsBase,
    )) {
      const ref = normalizeReference(leaf.reference);
      if (ref === null) continue;
      applyRules({
        site: {
          reference: ref,
          kind: "groupComposition" as const,
          path: [...path, "reference"],
        },
        enclosingRank: RANK_GROUP_COMPOSITION,
        producedAt,
        issues,
        allowedProducerRanks: new Set([RANK_INTRO]),
      });
    }
  });

  // Game stages
  gameStages.forEach((stage, stageIdx) => {
    if (!isRecord(stage)) return;
    const rank = RANK_GAME_BASE + stageIdx;
    const stagePath = [...treatmentPath, "gameStages", stageIdx];
    for (const site of enumerateStepSites(stage, stagePath)) {
      applyRules({
        site,
        enclosingRank: rank,
        producedAt,
        issues,
        phaseLabel: "game stage",
      });
    }
    // Discussion conditions nested under the stage
    const discussion = stage.discussion;
    if (isRecord(discussion)) {
      for (const { leaf, path } of walkConditionLeaves(discussion.conditions, [
        ...stagePath,
        "discussion",
        "conditions",
      ])) {
        const ref = normalizeReference(leaf.reference);
        if (ref === null) continue;
        applyRules({
          site: {
            reference: ref,
            kind: "discussionCondition",
            path: [...path, "reference"],
          },
          enclosingRank: rank,
          producedAt,
          issues,
          phaseLabel: "game stage",
        });
      }
    }
  });

  // Exit sequence
  exitSequence.forEach((step, stepIdx) => {
    if (!isRecord(step)) return;
    const rank = RANK_GAME_BASE + gameStages.length + stepIdx;
    const stepPath = [...treatmentPath, "exitSequence", stepIdx];
    for (const site of enumerateStepSites(step, stepPath)) {
      applyRules({
        site,
        enclosingRank: rank,
        producedAt,
        issues,
        phaseLabel: "exit step",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Reference-site enumeration
// ---------------------------------------------------------------------------

interface RefSite {
  /** The reference, normalized to its structured form (#240). */
  reference: ReferenceType;
  kind: ReferenceKind;
  path: (string | number)[];
  /** Stage-level conditions only: needed for Rule 2 simulation. */
  comparator?: string;
  value?: unknown;
}

/** Enumerate every reference site inside a single step/stage:
 *  stage-level conditions + every element's conditions + display refs +
 *  urlParam refs. Discussion conditions are handled separately at the
 *  stage walker (they live on `stage.discussion.conditions`, not on an
 *  element).
 *
 *  Conditions can be a flat array (implicit `all`), an `all`/`any`/`none`
 *  operator object, or a single leaf — `walkConditionLeaves` flattens
 *  the tree and yields each leaf with its absolute path.
 */
function enumerateStepSites(
  step: unknown,
  stepPath: (string | number)[],
): RefSite[] {
  const sites: RefSite[] = [];
  if (!isRecord(step)) return sites;

  // Stage-level conditions
  for (const { leaf, path } of walkConditionLeaves(step.conditions, [
    ...stepPath,
    "conditions",
  ])) {
    const ref = normalizeReference(leaf.reference);
    if (ref === null) continue;
    sites.push({
      reference: ref,
      kind: "stageCondition",
      path: [...path, "reference"],
      comparator:
        typeof leaf.comparator === "string" ? leaf.comparator : undefined,
      value: leaf.value,
    });
  }

  // Element-level sites
  const elements = toArray(step.elements);
  elements.forEach((element, elemIdx) => {
    if (!isRecord(element)) return;
    const elemPath = [...stepPath, "elements", elemIdx];
    const elemType = element.type;

    // conditions on any element
    for (const { leaf, path } of walkConditionLeaves(element.conditions, [
      ...elemPath,
      "conditions",
    ])) {
      const ref = normalizeReference(leaf.reference);
      if (ref === null) continue;
      sites.push({
        reference: ref,
        kind: "elementCondition",
        path: [...path, "reference"],
      });
    }

    // display element: its own top-level `reference` field
    if (elemType === "display") {
      const ref = normalizeReference(element.reference);
      if (ref !== null) {
        sites.push({
          reference: ref,
          kind: "displayReference",
          path: [...elemPath, "reference"],
        });
      }
    }

    // trackedLink / qualtrics: each urlParams entry can carry a reference
    if (elemType === "trackedLink" || elemType === "qualtrics") {
      const urlParams = toArray(element.urlParams);
      urlParams.forEach((param, paramIdx) => {
        if (!isRecord(param)) return;
        const ref = normalizeReference(param.reference);
        if (ref === null) return;
        sites.push({
          reference: ref,
          kind: "urlParam",
          path: [...elemPath, "urlParams", paramIdx, "reference"],
        });
      });
    }
  });

  return sites;
}

// ---------------------------------------------------------------------------
// Rule application
// ---------------------------------------------------------------------------

function applyRules({
  site,
  enclosingRank,
  producedAt,
  issues,
  priorPhaseKeys,
  laterPhaseKeys,
  allowedProducerRanks,
  phaseLabel,
}: {
  site: RefSite;
  enclosingRank: number;
  producedAt: Map<string, number>;
  issues: ReferenceValidationIssue[];
  /** For exit-phase walkers: keys produced by earlier phases that aren't
   *  in the exit-local producedAt map. */
  priorPhaseKeys?: Set<string>;
  /** For intro-phase walkers: keys produced by later phases. Any target in
   *  this set is a cross-phase forward reference. */
  laterPhaseKeys?: Set<string>;
  /** For groupComposition: a whitelist of producer ranks that the target
   *  key must live in. Anything else (or a non-whitelisted stage-produced
   *  target) is rejected. */
  allowedProducerRanks?: Set<number>;
  /** Context word used in error messages — "game stage", "intro step", … */
  phaseLabel?: string;
}): void {
  // Try to derive the storage key from the (already normalised) ref.
  let referenceKey: string;
  try {
    ({ referenceKey } = getReferenceKeyAndPath(site.reference));
  } catch {
    // Malformed references are a different class of error — not our job.
    return;
  }

  // Render the ref back to its dotted form for error messages.
  const refStr = formatReference(site.reference);
  // Determine the source. External sources always validate; stage-produced
  // sources go through the producer check.
  const refType = site.reference.source;
  if (!STAGE_PRODUCED_REF_TYPES.has(refType)) return;

  // Look up the producer rank. If the key isn't produced anywhere in the
  // treatment (and not in the prior-phase keys), skip — it's either a
  // typo (other tooling) or produced by external state we can't model.
  const producerRank =
    producedAt.get(referenceKey) ??
    (priorPhaseKeys?.has(referenceKey) ? RANK_INTRO : undefined);
  if (producerRank === undefined) {
    // Cross-phase forward reference: intro-step site referencing a key
    // produced by any later phase (game / exit) across treatments.
    if (laterPhaseKeys?.has(referenceKey)) {
      const phase = phaseLabel ?? "stage";
      issues.push({
        path: site.path,
        message: `Reference "${refStr}" points at data produced by a later phase (game or exit) than this ${phase}. Forward references across phases are always falsy at runtime — move the reference or reorder the flow.`,
      });
      return;
    }
    // Unknown reference: the target key isn't produced anywhere this
    // treatment can reach. Strict by default (#321): every reference
    // must resolve to a producer in the consuming treatment's
    // reachable set (intros + own gameStages + own exit). The
    // previous `globalProducedKeys` fallthrough was relaxed to allow
    // any key produced anywhere in the file, which silently masked
    // three categories of real bug: cross-treatment leaks (producer
    // in another treatment), references to keys produced only in an
    // uninvoked template, and refs to keys in templates this
    // treatment doesn't invoke. All three look the same at runtime
    // (consumer's participant never traverses the producer) and now
    // surface here at the source position.
    //
    // On the source pass (pre-hydration), this rule will false-fire
    // on legitimate template-injected references — their producer is
    // in a template that this treatment invokes, but `producedAt`
    // doesn't see template content until expansion. The diff
    // orchestrator (`runValidationDiff`) routes those to the
    // `sourceOnly` bucket and the editor surfaces them as warnings,
    // not errors. Single-pass callers that validate raw source
    // directly should use the orchestrator if they want to
    // distinguish artifacts from real bugs; runtime hosts that
    // validate hydrated content see this check fire only on real
    // unreachable references.
    // Scope wording depends on which walker is calling us. Intro
    // sequences validate in isolation (their reachable set is just the
    // earlier intro steps in this sequence); treatments validate
    // against `producedAt` seeded with intro + own gameStages + own
    // exit + invoked templates. `phaseLabel === "intro step"` is the
    // tell that we're in the intro-sequence walker.
    const inIntroSequence = phaseLabel === "intro step";
    const scopeDescription = inIntroSequence
      ? "this intro sequence"
      : "this treatment";
    const reachableDescription = inIntroSequence
      ? "earlier in this intro sequence"
      : "in this treatment's intro, game, or exit stages (or in a template this treatment invokes)";
    issues.push({
      path: site.path,
      message: `Reference "${refStr}" doesn't match any ${refType} element reachable from ${scopeDescription}. Check the name — no element produces the storage key "${referenceKey}" ${reachableDescription}.`,
    });
    return;
  }

  // groupComposition: target must be in the allowed-rank whitelist.
  // When the whitelist applies and the producer is in it, the
  // reference is good — skip the rank-based forward-ref check below.
  // (The rank model puts groupComposition at -1, which is numerically
  // less than RANK_INTRO. A naive Rule 1 application would reject any
  // intro reference as a "forward reference," but allowedProducerRanks
  // is exactly the whitelist that says "yes, this is reachable from
  // groupComposition despite the rank arithmetic.")
  if (allowedProducerRanks) {
    if (!allowedProducerRanks.has(producerRank)) {
      issues.push({
        path: site.path,
        message: `groupComposition condition references "${refStr}", which is produced by a game or exit stage. groupComposition is evaluated before any stage runs — it can only reference intro-phase data or external values (entryUrl.params.*, participantInfo.*, …).`,
      });
    }
    return;
  }

  // Rule 1 — forward reference. Reject if the producer is in a later stage.
  if (producerRank > enclosingRank) {
    const phase = phaseLabel ?? "stage";
    issues.push({
      path: site.path,
      message: `Reference "${refStr}" points at data produced by a later ${phase} (rank ${String(producerRank)}) than the one this condition/reference belongs to (rank ${String(enclosingRank)}). Forward references are always falsy at runtime — reorder the stages or move the reference.`,
    });
    return;
  }

  // Rule 2 — stage-level "always-skip at load". Only applies to
  // stageCondition sites whose reference points at the *current* stage.
  //
  // Restriction (#235): the per-leaf simulation is only sound when the
  // leaf is reached without traversing an `any:` or `none:` operator.
  // Inside those operators a single non-true leaf doesn't doom the
  // tree (a sibling can carry the operator to true), so flagging it
  // would false-positive on perfectly valid authoring patterns. `all:`
  // is equivalent to the flat-array sugar, so leaves inside `all:` are
  // fair game.
  //
  // A future improvement: full tree simulation that replaces every
  // current-stage leaf with `compare(undefined, …)` and evaluates the
  // whole tri-state tree, flagging only when the result is strictly
  // not-true. For now the conservative path-check below avoids
  // false-positives at the cost of missing some legitimate
  // always-skip-at-load patterns inside `any:`/`none:`.
  if (
    site.kind === "stageCondition" &&
    producerRank === enclosingRank &&
    site.comparator !== undefined &&
    !pathTraversesNonAllOperator(site.path)
  ) {
    const result = compare(
      undefined,
      site.comparator as Comparator,
      site.value,
    );
    if (result !== true) {
      issues.push({
        path: site.path,
        message: `Stage-level condition on "${refStr}" will always skip the stage at load. This references the current stage's data, which is undefined at mount, and compare(undefined, "${site.comparator}", …) is not true. Did you mean \`comparator: doesNotExist\` (the usual pattern for ending a stage once a value arrives)?`,
      });
    }
  }
}

/** True if the path passes through an `any:` or `none:` operator key
 *  (not `all:`, since `all:` is semantically equivalent to the flat
 *  array sugar). Used to gate Rule 2 (always-skip-at-load) so leaves
 *  nested inside `any`/`none` operators don't false-positive — a
 *  single non-true leaf there can be carried to true by siblings. */
function pathTraversesNonAllOperator(path: (string | number)[]): boolean {
  return path.some((seg) => seg === "any" || seg === "none");
}

// ---------------------------------------------------------------------------
// Produced-key collection
// ---------------------------------------------------------------------------

/** Collect every storage key produced by the elements inside a single step
 *  (stage or intro/exit step). */
function collectStepKeys(step: unknown): Set<string> {
  const keys = new Set<string>();
  if (!isRecord(step)) return keys;
  for (const el of toArray(step.elements)) {
    collectProducedKeys(el, keys);
  }
  return keys;
}

/** Map an element to its storage key (or keys) and add them to `acc`.
 *  The key conventions mirror `getReferenceKeyAndPath` so lookups line up.
 */
function collectProducedKeys(element: unknown, acc: Set<string>): void {
  if (!isRecord(element)) return;
  const type = element.type;
  const name = element.name;
  if (typeof type !== "string") return;
  // Survey elements fall back to `surveyName` when `name` is absent —
  // mirrors the runtime storage-key derivation in Element.tsx:
  // `survey_${element.name ?? element.surveyName}`. Without this fallback,
  // a reference to `survey.<surveyName>` (common when authors omit `name`)
  // would silently escape the forward-ref check.
  if (type === "survey") {
    const keyName =
      typeof name === "string"
        ? name
        : typeof element.surveyName === "string"
          ? element.surveyName
          : undefined;
    if (keyName !== undefined) acc.add(`survey_${keyName}`);
    return;
  }
  if (
    typeof name === "string" &&
    (type === "prompt" ||
      type === "submitButton" ||
      type === "qualtrics" ||
      type === "timeline" ||
      type === "trackedLink")
  ) {
    acc.add(`${type}_${name}`);
  }
  // "discussion" references use the discussion's own name as the storage
  // key (per getReferenceKeyAndPath's `discussion` branch). We don't
  // currently track discussion names as produced keys at this level —
  // discussions are a stage-level construct and their metrics come from
  // runtime, not from a tracked element. Skipping is safe because
  // references to discussion keys fall through to the "target not in
  // producedAt" branch (no false positives) and runtime handles them.
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
