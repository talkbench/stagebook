/**
 * Post-hydration "unsatisfiable condition" rule (#480).
 *
 * A condition `{reference, comparator, value}` that reads a prompt's answer
 * (`self.prompt.<name>.value`) is a *dead gate* when NO value the prompt can
 * ever produce satisfies the comparator — e.g. `includes "joint solution"`
 * against a multipleChoice whose options contain that substring in none of
 * them, usually after the option wording was edited but the condition wasn't
 * (or vice versa). The reference resolves and the YAML is well-formed, so the
 * reference validator passes it; at runtime the gate simply never resolves and
 * the participant gets stuck (submit button never enables, element never
 * shows). This static check catches that whole class before launch.
 *
 * Design (kept deliberately conservative — only flag *provably* dead gates):
 *
 *   - Resolve each prompt-answer condition's referenced prompt to its bounded
 *     value domain (multipleChoice options, dropdown options, slider snap
 *     points). Flag only when EVERY domain member makes `compare()` return
 *     strictly `false`. `compare()` returning `undefined` (a type it can't
 *     decide — text option vs numeric comparator, an invalid regex, …) is
 *     "can't prove dead" and stays silent. This reuses the exact runtime
 *     comparator over the exact stored values, so the rule can't drift from
 *     runtime coercion (string "6" vs int 6, list-vs-numeric option storage).
 *   - `openResponse` is free text, so value comparators can't be disproven —
 *     but its length is bounded by `minLength`/`maxLength`, so
 *     `hasLengthAtLeast N` with `maxLength < N` (and the `hasLengthAtMost`
 *     mirror) IS provably dead.
 *   - Negative comparators (`doesNotEqual` / `doesNotInclude` / `doesNotMatch`
 *     / `isNotOneOf`) and `exists` / `doesNotExist` are satisfiable via the
 *     undefined initial state (the answer is absent at mount, #348) — skipped.
 *   - Multi-select multipleChoice stores an array, not a scalar, which changes
 *     what several comparators mean; skipped in v1 (documented non-goal).
 *   - Anything the rule can't pin down exactly (unknown prompt name, a name
 *     that maps to two different files, a prompt the host couldn't load, a
 *     reference that reads a subpath other than the answer, an unresolved
 *     `${...}` placeholder in the value) is skipped — false positives stay at
 *     zero, at the cost of missing some dead gates.
 *
 * Pure over already-loaded data, mirroring the locale-consistency rule
 * ([[localeConsistency]]): the host (CLI, extension, viewer) owns file I/O and
 * supplies each referenced prompt's parsed value-domain via a map. The
 * host-side wiring lives in `validate/unsatisfiableConditions.ts`.
 */

import { compare, type Comparator } from "../utils/compare.js";
import { getReferenceKeyAndPath } from "../utils/reference.js";
import { OPERATOR_KEYS } from "./conditionOperators.js";
import {
  parseDottedReference,
  formatReference,
  type ReferenceType,
} from "./reference.js";
import type { PromptFileType } from "./promptFile.js";

export interface UnsatisfiableConditionIssue {
  /** Absolute path into the treatment-file tree, ending at the condition's
   *  `value` (the token the author most likely needs to fix). */
  path: (string | number)[];
  /** Dotted form of the offending reference, e.g. `self.prompt.goal`. */
  reference: string;
  message: string;
}

/** Comparators whose truth depends on the value matching (or relating to) a
 *  concrete stored value. Their negatives, plus `exists`/`doesNotExist`, are
 *  omitted: they're satisfiable via the undefined-at-mount initial state and
 *  so are never provably dead against a bounded domain.
 *
 *  `matches` is deliberately omitted too. It would make `compare()` build a
 *  RegExp from the author's `value` and run it against every option label —
 *  both author-controlled — at validation time, in the editor/CLI/viewer
 *  process. A crafted catastrophic-backtracking pattern (`(a+)+$`) against a
 *  long label would freeze that process (the `try/catch` below only catches a
 *  *throwing* regex, not a slow one). A regex domain-check is the weakest
 *  detection anyway, so dropping it costs little and removes the ReDoS vector
 *  entirely. */
const CHECKABLE_COMPARATORS: ReadonlySet<string> = new Set<Comparator>([
  "equals",
  "includes",
  "isOneOf",
  "isAbove",
  "isBelow",
  "isAtLeast",
  "isAtMost",
  "hasLengthAtLeast",
  "hasLengthAtMost",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeReference(input: unknown): ReferenceType | null {
  if (typeof input === "string") {
    const parsed = parseDottedReference(input);
    return parsed.ok ? parsed.value : null;
  }
  if (isRecord(input) && "source" in input) return input as ReferenceType;
  return null;
}

/** True if a string (or any string element of an array) still carries an
 *  unresolved `${...}` template placeholder — can't be evaluated statically. */
function containsPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return value.includes("${");
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  return false;
}

interface ConditionLeafSite {
  leaf: Record<string, unknown>;
  /** Path to the leaf object itself. */
  path: (string | number)[];
}

/** Yield each leaf of a `conditions:` tree with its absolute path. Handles the
 *  flat-array sugar, the `all`/`any`/`none` operator objects, and bare leaves.
 *  Template invocations are skipped (content unknown until expansion). Leaves
 *  inside `any`/`none` are yielded (the path records the operators it passed
 *  through); the caller decides whether to act on them — see
 *  `pathTraversesNonAllOperator`.
 *
 *  Recursion depth is unbounded here but bounded upstream: js-yaml overflows on
 *  nested `conditions:` well before this walker would, so a maliciously deep
 *  tree is rejected at parse time in every wiring path (CLI, diff-validator)
 *  before it reaches this function. */
function* walkConditionLeaves(
  conditions: unknown,
  pathPrefix: (string | number)[],
): Generator<ConditionLeafSite> {
  if (conditions === undefined || conditions === null) return;

  if (Array.isArray(conditions)) {
    for (let i = 0; i < conditions.length; i++) {
      yield* walkConditionLeaves(conditions[i], [...pathPrefix, i]);
    }
    return;
  }

  if (!isRecord(conditions)) return;

  for (const op of OPERATOR_KEYS) {
    const children = conditions[op];
    if (Array.isArray(children)) {
      for (let i = 0; i < children.length; i++) {
        yield* walkConditionLeaves(children[i], [...pathPrefix, op, i]);
      }
      return;
    }
  }

  if ("template" in conditions) return;

  yield { leaf: conditions, path: pathPrefix };
}

/** True if a leaf's path passes through an `any:` or `none:` operator (`all:`
 *  is equivalent to the flat-array sugar, so it doesn't count). Such a leaf's
 *  deadness does NOT make the enclosing gate dead — a false leaf under `any:`
 *  can be carried true by a sibling, and under `none:` a false leaf makes the
 *  gate *always fire*. Flagging it "can never be true" would be a false
 *  positive, so the caller skips these. Mirrors the identical restriction on
 *  the always-skip-at-load rule in `validateReferences.ts`. */
function pathTraversesNonAllOperator(path: (string | number)[]): boolean {
  return path.some((seg) => seg === "any" || seg === "none");
}

/** Yield every `conditions:` block in the treatment file (stage-level,
 *  discussion, and element-level) across game stages, exit steps, and intro
 *  steps, flattened to leaves with absolute paths. */
function* walkAllConditionLeaves(
  fileObj: Record<string, unknown>,
): Generator<ConditionLeafSite> {
  const stageLists: { stages: unknown; base: (string | number)[] }[] = [];

  toArray(fileObj.treatments).forEach((t, ti) => {
    if (!isRecord(t)) return;
    stageLists.push({
      stages: t.gameStages,
      base: ["treatments", ti, "gameStages"],
    });
    stageLists.push({
      stages: t.exitSequence,
      base: ["treatments", ti, "exitSequence"],
    });
  });
  toArray(fileObj.introSequences).forEach((seq, si) => {
    if (!isRecord(seq)) return;
    stageLists.push({
      stages: seq.introSteps,
      base: ["introSequences", si, "introSteps"],
    });
  });

  for (const { stages, base } of stageLists) {
    const stageArr = toArray(stages);
    for (let gi = 0; gi < stageArr.length; gi++) {
      const stage = stageArr[gi];
      if (!isRecord(stage)) continue;
      const stagePath = [...base, gi];
      yield* walkConditionLeaves(stage.conditions, [
        ...stagePath,
        "conditions",
      ]);
      if (isRecord(stage.discussion)) {
        yield* walkConditionLeaves(stage.discussion.conditions, [
          ...stagePath,
          "discussion",
          "conditions",
        ]);
      }
      const elements = toArray(stage.elements);
      for (let ei = 0; ei < elements.length; ei++) {
        const el = elements[ei];
        if (!isRecord(el)) continue;
        yield* walkConditionLeaves(el.conditions, [
          ...stagePath,
          "elements",
          ei,
          "conditions",
        ]);
      }
    }
  }
}

/** Map each prompt element's `name` to the set of `file:` paths it points at,
 *  across every stage/step. A name that maps to more than one distinct file is
 *  ambiguous (the condition could resolve to either domain) and is skipped by
 *  the caller. */
function buildPromptNameToFiles(
  fileObj: Record<string, unknown>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (name: unknown, file: unknown) => {
    if (typeof name !== "string" || typeof file !== "string") return;
    const set = map.get(name) ?? new Set<string>();
    set.add(file);
    map.set(name, set);
  };
  const scanStages = (stages: unknown) => {
    for (const stage of toArray(stages)) {
      if (!isRecord(stage)) continue;
      for (const el of toArray(stage.elements)) {
        if (isRecord(el) && el.type === "prompt") add(el.name, el.file);
      }
    }
  };
  for (const t of toArray(fileObj.treatments)) {
    if (!isRecord(t)) continue;
    scanStages(t.gameStages);
    scanStages(t.exitSequence);
  }
  for (const seq of toArray(fileObj.introSequences)) {
    if (isRecord(seq)) scanStages(seq.introSteps);
  }
  return map;
}

/** The bounded set of scalar values a single-valued prompt can store, or
 *  `null` when the prompt has no statically-checkable scalar domain
 *  (openResponse — handled separately; multi-select, listSorter, noResponse —
 *  skipped). Both option labels and numeric points are included so the rule is
 *  robust to whether the runtime stores a label or a point for numeric-mode
 *  choices: over-approximating the domain can only suppress a flag, never
 *  invent one. */
function scalarDomain(parsed: PromptFileType): unknown[] | null {
  switch (parsed.metadata.type) {
    case "multipleChoice":
      if (parsed.metadata.select === "multiple") return null;
      return [...parsed.responseItems, ...parsed.responsePoints];
    case "dropdown":
      return [...parsed.responseItems];
    case "slider":
      return [...parsed.responsePoints];
    default:
      return null;
  }
}

/** For openResponse (free text bounded only by length), decide whether a
 *  length comparator is provably impossible. Returns `null` when not
 *  provable. */
function openResponseLengthDeadReason(
  parsed: PromptFileType,
  comparator: string,
  value: unknown,
): string | null {
  if (parsed.metadata.type !== "openResponse") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const { minLength, maxLength } = parsed.metadata;
  if (
    comparator === "hasLengthAtLeast" &&
    maxLength !== undefined &&
    maxLength < n
  ) {
    return `the prompt's maxLength is ${maxLength}, so no response can be ${n} characters or longer`;
  }
  if (
    comparator === "hasLengthAtMost" &&
    minLength !== undefined &&
    minLength > n
  ) {
    return `the prompt's minLength is ${minLength}, so every response is longer than ${n} characters`;
  }
  return null;
}

/** True when no member of `domain` makes `compare(member, comparator, value)`
 *  return `true`, AND at least one member returns strictly `false` (i.e. the
 *  comparator was decidable and rejected every value). If any member is
 *  `undefined` (undecidable — a type `compare()` can't relate, or a regex that
 *  throws), we can't prove deadness and return false. */
function isProvablyDead(
  domain: unknown[],
  comparator: Comparator,
  value: unknown,
): boolean {
  if (domain.length === 0) return false;
  let sawDecidableFalse = false;
  for (const member of domain) {
    let result: boolean | undefined;
    try {
      result = compare(member, comparator, value);
    } catch {
      // Defensive: any comparator that throws is treated as undecidable
      // rather than allowed to abort the whole validation pass.
      result = undefined;
    }
    if (result === true) return false;
    if (result === false) sawDecidableFalse = true;
  }
  return sawDecidableFalse;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  return JSON.stringify(value);
}

function describeDomain(parsed: PromptFileType): string {
  // Numeric-mode multipleChoice and sliders store the point, not the label, so
  // list the points (with their labels for readability) — otherwise an author
  // debugging `equals 99` sees only text labels, none of which look like 99.
  if (parsed.responsePoints.length > 0) {
    return parsed.responsePoints
      .map((p, i) => {
        const label = parsed.responseItems[i];
        return label !== undefined && String(p) !== label
          ? `${p} ("${label}")`
          : String(p);
      })
      .join(", ");
  }
  return parsed.responseItems.map((i) => `"${i}"`).join(", ");
}

/**
 * Run the unsatisfiable-condition rule.
 *
 * @param fileObj hydrated (post-fillTemplates) treatment file object.
 * @param promptDomains map from a prompt element's `file:` path (exactly as it
 *   appears in the treatment) to that prompt's parsed value-domain. Paths
 *   absent from the map are skipped (the host couldn't load/parse them —
 *   missing-file and invalid-prompt problems have their own reporting).
 */
export function checkUnsatisfiableConditions(
  fileObj: unknown,
  promptDomains: ReadonlyMap<string, PromptFileType>,
): UnsatisfiableConditionIssue[] {
  const issues: UnsatisfiableConditionIssue[] = [];
  if (!isRecord(fileObj)) return issues;

  const nameToFiles = buildPromptNameToFiles(fileObj);

  for (const { leaf, path } of walkAllConditionLeaves(fileObj)) {
    // A dead leaf under `any:`/`none:` doesn't doom its gate (see
    // `pathTraversesNonAllOperator`), so flagging it would misreport a
    // satisfiable gate as dead.
    if (pathTraversesNonAllOperator(path)) continue;

    const comparator = leaf.comparator;
    if (typeof comparator !== "string") continue;
    if (!CHECKABLE_COMPARATORS.has(comparator)) continue;

    const ref = normalizeReference(leaf.reference);
    if (ref === null || ref.source !== "prompt") continue;
    if (!("name" in ref) || typeof ref.name !== "string") continue;
    if (ref.name.includes("${")) continue;

    // Only the answer value (`prompt.<name>` / `prompt.<name>.value`) has a
    // domain we can reason about; other subpaths address host-specific
    // structure we don't model.
    let refPath: string[];
    try {
      ({ path: refPath } = getReferenceKeyAndPath(ref));
    } catch {
      continue;
    }
    if (!(refPath.length === 1 && refPath[0] === "value")) continue;

    const value = leaf.value;
    if (value === undefined || containsPlaceholder(value)) continue;

    const files = nameToFiles.get(ref.name);
    if (!files || files.size !== 1) continue;
    const file = [...files][0];
    const parsed = promptDomains.get(file);
    if (parsed === undefined) continue;

    const reference = formatReference(ref);
    const valuePath = [...path, "value"];

    // openResponse: length comparators only.
    if (parsed.metadata.type === "openResponse") {
      const reason = openResponseLengthDeadReason(parsed, comparator, value);
      if (reason !== null) {
        issues.push({
          path: valuePath,
          reference,
          message:
            `Unsatisfiable condition: \`${reference} ${comparator} ${describeValue(value)}\` ` +
            `can never be true — ${reason}.`,
        });
      }
      continue;
    }

    const domain = scalarDomain(parsed);
    if (domain === null) continue;
    if (!isProvablyDead(domain, comparator as Comparator, value)) continue;

    issues.push({
      path: valuePath,
      reference,
      message:
        `Unsatisfiable condition: \`${reference} ${comparator} ${describeValue(value)}\` ` +
        `can never be true. The referenced ${parsed.metadata.type} can only produce: ${describeDomain(parsed)}. ` +
        `No value satisfies the comparator — did the option wording change since the condition was written?`,
    });
  }

  return issues;
}
