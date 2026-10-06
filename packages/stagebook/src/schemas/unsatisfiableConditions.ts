/** Conservative, post-hydration reachability checks over full condition trees.
 * Finite choice answers (including the unanswered state) run through the same
 * readReference/evaluator boundary as runtime. Unknown inputs never stand in
 * for Missing: they leave a proof open. Slider and text-length bounds can also
 * prove a Boolean branch impossible without enumerating an unbounded domain.
 *
 * Enumeration is capped, and everyone references are deliberately unmodeled:
 * a roster/domain Cartesian product is not a safe editor-time workload. Regex
 * roots are skipped so validation never executes researcher-authored regexes. */
import { evaluateExpression } from "../expressions/evaluateExpression.js";
import { Missing } from "../expressions/missing.js";
import {
  walkExpression,
  type ExpressionPath,
} from "../expressions/walkExpression.js";
import { readReference } from "../utils/readReference.js";
import { getReferenceKeyAndPath } from "../utils/reference.js";
import { resolvedExpressionConditionsSchema } from "./expression.js";
import { referenceSchema, formatReference } from "./reference.js";
import type { PromptFileType } from "./promptFile.js";

export interface UnsatisfiableConditionIssue {
  /** Absolute path to the entire conditions root that can never be true. */
  path: ExpressionPath;
  /** First reference in the root, retained for consumers; empty for constants. */
  reference: string;
  message: string;
}

const MAX_NODES = 512;
const MAX_ASSIGNMENTS = 2048;
const MAX_EVALUATIONS = 8192;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const toArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const producerKey = (name: string, shared: boolean) =>
  JSON.stringify([shared, name]);
const storageKey = (scope: string, key: string) => JSON.stringify([scope, key]);

interface ConditionSite {
  conditions: unknown;
  path: ExpressionPath;
}
function* stageConditions(
  stages: unknown,
  base: ExpressionPath,
): Generator<ConditionSite> {
  for (const [index, stage] of toArray(stages).entries()) {
    if (!isRecord(stage)) continue;
    const path = [...base, index];
    if (own(stage, "conditions"))
      yield { conditions: stage.conditions, path: [...path, "conditions"] };
    if (isRecord(stage.discussion) && own(stage.discussion, "conditions"))
      yield {
        conditions: stage.discussion.conditions,
        path: [...path, "discussion", "conditions"],
      };
    for (const [elementIndex, element] of toArray(stage.elements).entries()) {
      if (isRecord(element) && own(element, "conditions"))
        yield {
          conditions: element.conditions,
          path: [...path, "elements", elementIndex, "conditions"],
        };
    }
  }
}
function addProducers(
  stages: unknown,
  producers: Map<string, Set<string>>,
): void {
  for (const stage of toArray(stages)) {
    if (!isRecord(stage)) continue;
    for (const element of toArray(stage.elements)) {
      if (
        !isRecord(element) ||
        element.type !== "prompt" ||
        typeof element.name !== "string" ||
        typeof element.file !== "string"
      )
        continue;
      const key = producerKey(element.name, element.shared === true);
      const files = producers.get(key) ?? new Set<string>();
      files.add(element.file);
      producers.set(key, files);
    }
  }
}

/** Reject unresolved syntax and bound traversal before schema/walker recursion.
 * Aliases are counted per authored occurrence, so shared DAGs cannot expand
 * into an unbounded validation workload. Unresolved placeholders anywhere in
 * the authored data leave the root unproven. */
function boundedResolvedTree(value: unknown): boolean {
  let nodes = 0;
  const active = new Set<object>();
  function visit(input: unknown, depth: number): boolean {
    if (++nodes > MAX_NODES || depth > 64) return false;
    if (typeof input === "string") return !input.includes("${");
    if (input === null || typeof input !== "object") return true;
    if (active.has(input)) return false;
    active.add(input);
    try {
      if (Array.isArray(input))
        return input.every((item: unknown) => visit(item, depth + 1));
      if (!isRecord(input) || own(input, "template")) return false;
      return Object.values(input).every((item) => visit(item, depth + 1));
    } finally {
      active.delete(input);
    }
  }
  return visit(value, 0);
}

interface PromptDomain {
  key: string;
  prompt: PromptFileType;
  values: unknown[] | null;
}
function promptDomain(
  input: unknown,
  producers: ReadonlyMap<string, Set<string>>,
  prompts: ReadonlyMap<string, PromptFileType>,
): PromptDomain | undefined {
  const parsed = referenceSchema.safeParse(input);
  if (!parsed.success) return;
  const reference = parsed.data;
  if (reference.source !== "prompt" || reference.position === "everyone")
    return;
  const { referenceKey, path } = getReferenceKeyAndPath(reference);
  if (path.length !== 1 || path[0] !== "value") return;
  const files = producers.get(
    producerKey(reference.name, reference.position === "shared"),
  );
  // Conflicting producers are conservative unknowns even when all files load.
  if (!files || files.size !== 1) return;
  const prompt = prompts.get([...files][0]);
  if (!prompt) return;
  const scope =
    reference.position === "self" ? "player" : String(reference.position);
  const domain = scalarDomain(prompt);
  return {
    key: storageKey(scope, referenceKey),
    prompt,
    values: domain === null ? null : [Missing, ...domain],
  };
}

function scalarDomain(parsed: PromptFileType): unknown[] | null {
  switch (parsed.metadata.type) {
    case "multipleChoice":
      if (parsed.metadata.select === "multiple") return null;
      return parsed.responsePoints.length > 0
        ? [...parsed.responsePoints]
        : [...parsed.responseItems];
    case "dropdown":
      return [...parsed.responseItems];
    default:
      return null;
  }
}

/** For a slider, decide whether a comparator is provably impossible against its
 *  reachable value set — every snap point `min + k*interval` in `[min, max]`
 *  (see `Slider.tsx`), NOT only the labeled ticks in the prompt body. Returns a
 *  human-readable reason when provable, else `null`. Range comparators are
 *  decided by the endpoints; `equals`/`isOneOf` are only flagged when the
 *  target is fully outside `[min, max]` (an in-range value might land on an
 *  unlabeled snap point, so it's left alone to keep false positives at zero). */
function sliderDeadReason(
  parsed: PromptFileType,
  comparator: string,
  value: unknown,
): string | null {
  if (parsed.metadata.type !== "slider") return null;
  const { min, max } = parsed.metadata;
  const range = `[${min}, ${max}]`;
  const toNum = (v: unknown): number => (typeof v === "number" ? v : NaN);

  if (comparator === "equals" || comparator === "isOneOf") {
    const targets = comparator === "isOneOf" ? value : [value];
    if (!Array.isArray(targets) || targets.length === 0) return null;
    const nums = targets.map(toNum);
    // Only provable when every target is a finite number outside the range;
    // a non-numeric or in-range target means "can't prove dead".
    if (!nums.every((n) => Number.isFinite(n) && (n < min || n > max))) {
      return null;
    }
    return `the slider only ranges over ${range}, so no reachable value ${
      comparator === "equals" ? "equals" : "is one of"
    } ${describeValue(value)}`;
  }

  const n = toNum(value);
  if (!Number.isFinite(n)) return null;
  switch (comparator) {
    case "isAtLeast":
      return n > max
        ? `the slider maxes out at ${max}, so no value is at least ${n}`
        : null;
    case "isAbove":
      return n >= max
        ? `the slider maxes out at ${max}, so no value is above ${n}`
        : null;
    case "isAtMost":
      return n < min
        ? `the slider bottoms out at ${min}, so no value is at most ${n}`
        : null;
    case "isBelow":
      return n <= min
        ? `the slider bottoms out at ${min}, so no value is below ${n}`
        : null;
    default:
      // includes / matches / hasLength* are string operations on a number —
      // undecidable, so never flagged.
      return null;
  }
}

/** For openResponse (free text), decide whether a length comparator is provably
 *  impossible. Returns `null` when not provable.
 *
 *  Only `hasLengthAtLeast` vs `maxLength` is provable: `TextArea` blocks
 *  keystrokes past `maxLength`, so a response can never be longer than it. The
 *  `hasLengthAtMost`/`minLength` mirror is deliberately NOT checked — `TextArea`
 *  uses `minLength` only for the character counter and still saves shorter
 *  intermediate values as the participant types, so a short value IS reachable
 *  and flagging it would be a false positive. */
function openResponseLengthDeadReason(
  parsed: PromptFileType,
  comparator: string,
  value: unknown,
): string | null {
  if (parsed.metadata.type !== "openResponse") return null;
  if (comparator !== "hasLengthAtLeast") return null;
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return null;
  const { maxLength } = parsed.metadata;
  if (maxLength !== undefined && maxLength < n) {
    return `the prompt's maxLength is ${maxLength}, so no response can be ${n} characters or longer`;
  }
  return null;
}

function describeValue(value: unknown): string {
  return JSON.stringify(value);
}

interface Truths {
  canBeTrue: boolean;
  canBeFalse: boolean;
}
const unknownTruth: Truths = { canBeTrue: true, canBeFalse: true };
const falseTruth: Truths = { canBeTrue: false, canBeFalse: true };

function proveDead(
  expression: unknown,
  producers: ReadonlyMap<string, Set<string>>,
  prompts: ReadonlyMap<string, PromptFileType>,
): { reference: string; reasons: string[] } | undefined {
  const root = Array.isArray(expression) ? { all: expression } : expression;
  const visits = [...walkExpression(root)];
  if (
    visits.some(
      ({ operator, kind, node }) =>
        operator === "matches" ||
        (kind === "leaf" &&
          isRecord(node) &&
          (node.comparator === "matches" ||
            node.comparator === "doesNotMatch")),
    )
  )
    return;
  const domainCache = new Map<unknown, PromptDomain | undefined>();
  function lookup(reference: unknown): PromptDomain | undefined {
    if (!domainCache.has(reference))
      domainCache.set(reference, promptDomain(reference, producers, prompts));
    return domainCache.get(reference);
  }
  let evaluations = 0;
  const reasons = new Set<string>();
  const cache = new Map<unknown, Truths>();

  function enumerate(
    node: unknown,
    booleanOperand: boolean,
  ): Truths | undefined {
    const inputs = new Map<string, PromptDomain>();
    let assignments = 1;
    for (const visit of walkExpression(node)) {
      if (
        (visit.kind !== "reference" && visit.kind !== "leaf") ||
        !isRecord(visit.node)
      )
        continue;
      const domain = lookup(visit.node.reference);
      if (!domain?.values) return;
      if (inputs.has(domain.key)) continue;
      inputs.set(domain.key, domain);
      assignments *= domain.values.length;
      if (assignments > MAX_ASSIGNMENTS) return;
    }
    if (evaluations + assignments > MAX_EVALUATIONS) return;
    const domains = [...inputs.values()];
    const assignment = new Map<string, unknown>();
    const truths: Truths = { canBeTrue: false, canBeFalse: false };
    function evaluateAssignment(index: number): void {
      if (truths.canBeTrue && truths.canBeFalse) return;
      if (index < domains.length) {
        const domain = domains[index];
        for (const value of domain.values ?? []) {
          assignment.set(domain.key, value);
          evaluateAssignment(index + 1);
          if (truths.canBeTrue && truths.canBeFalse) return;
        }
        return;
      }
      evaluations++;
      // Boolean parent context can affect typed firstExisting/case selection.
      // Preserve that context when proving a child independently.
      const value = evaluateExpression(
        booleanOperand ? { all: [node] } : node,
        {
          readReference: (reference) =>
            readReference(reference, (key, scope) => [
              { value: assignment.get(storageKey(scope, key)) },
            ]),
        },
      );
      if (value === true) truths.canBeTrue = true;
      else truths.canBeFalse = true;
    }
    evaluateAssignment(0);
    return truths;
  }

  function possible(node: unknown, booleanOperand = false): Truths {
    const cached = cache.get(node);
    if (cached) return cached;
    const exact = enumerate(node, booleanOperand);
    if (exact) {
      cache.set(node, exact);
      return exact;
    }
    let result = unknownTruth;
    if (
      isRecord(node) &&
      own(node, "reference") &&
      typeof node.comparator === "string"
    ) {
      const domain = lookup(node.reference);
      if (domain) {
        const reason =
          sliderDeadReason(domain.prompt, node.comparator, node.value) ??
          openResponseLengthDeadReason(
            domain.prompt,
            node.comparator,
            node.value,
          );
        if (reason) {
          reasons.add(reason);
          result = falseTruth;
        }
      }
    } else if (isRecord(node)) {
      for (const key of ["all", "any", "none"] as const) {
        const children = node[key];
        // Scalar collection inputs may expand at runtime; only an explicit
        // expression array has the scalar Boolean slots modeled here.
        if (!Array.isArray(children) || children.length === 0) continue;
        const truths = children.map((child: unknown) => possible(child, true));
        if (key === "all")
          result = {
            canBeTrue: truths.every((truth) => truth.canBeTrue),
            canBeFalse: truths.some((truth) => truth.canBeFalse),
          };
        else
          result = {
            canBeTrue:
              key === "any"
                ? truths.some((truth) => truth.canBeTrue)
                : truths.every((truth) => truth.canBeFalse),
            canBeFalse:
              key === "any"
                ? truths.every((truth) => truth.canBeFalse)
                : truths.some((truth) => truth.canBeTrue),
          };
        break;
      }
    }
    cache.set(node, result);
    return result;
  }

  if (possible(root).canBeTrue) return;
  const first = visits.find(
    (visit) =>
      (visit.kind === "reference" || visit.kind === "leaf") &&
      isRecord(visit.node),
  );
  const parsed =
    first && isRecord(first.node)
      ? referenceSchema.safeParse(first.node.reference)
      : undefined;
  return {
    reference: parsed?.success ? formatReference(parsed.data) : "",
    reasons: [...reasons],
  };
}

/** Pure over already-loaded prompt data. Producers are scoped per treatment
 * plus compatible intros, per standalone intro, and per consent arm. */
export function checkUnsatisfiableConditions(
  fileObj: unknown,
  promptDomains: ReadonlyMap<string, PromptFileType>,
): UnsatisfiableConditionIssue[] {
  if (!isRecord(fileObj)) return [];
  const issues: UnsatisfiableConditionIssue[] = [];
  const collections = [
    { key: "treatments", lists: ["gameStages", "exitSequence"] },
    { key: "introSequences", lists: ["introSteps"] },
    { key: "consent", lists: ["steps"] },
  ];
  for (const { key, lists } of collections) {
    toArray(fileObj[key]).forEach((container, index) => {
      if (!isRecord(container)) return;
      const producers = new Map<string, Set<string>>();
      for (const list of lists) addProducers(container[list], producers);
      if (key === "treatments") {
        const pairing = container.compatibleIntroSequences;
        const concrete =
          Array.isArray(pairing) &&
          pairing.every(
            (name: unknown) => typeof name === "string" && !name.includes("${"),
          );
        for (const sequence of toArray(fileObj.introSequences)) {
          if (
            !isRecord(sequence) ||
            (concrete && !pairing.includes(sequence.name))
          )
            continue;
          addProducers(sequence.introSteps, producers);
        }
      }
      const sites = lists.flatMap((list) => [
        ...stageConditions(container[list], [key, index, list]),
      ]);
      if (key === "treatments") {
        toArray(container.groupComposition).forEach((player, playerIndex) => {
          if (isRecord(player) && own(player, "conditions"))
            sites.push({
              conditions: player.conditions,
              path: [key, index, "groupComposition", playerIndex, "conditions"],
            });
        });
      }
      for (const site of sites) {
        if (
          site.conditions === undefined ||
          !boundedResolvedTree(site.conditions) ||
          !resolvedExpressionConditionsSchema.safeParse(site.conditions).success
        )
          continue;
        const proof = proveDead(site.conditions, producers, promptDomains);
        if (!proof) continue;
        issues.push({
          path: site.path,
          reference: proof.reference,
          message:
            "Unsatisfiable condition: this condition tree can never be true for any reachable prompt answers, including unanswered prompts. " +
            `Expression: ${describeValue(site.conditions)}. ` +
            proof.reasons.join("; "),
        });
      }
    });
  }
  return issues;
}
