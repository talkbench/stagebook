import {
  walkExpression,
  type ExpressionPath,
} from "../expressions/walkExpression.js";
import { parseRegexLiteral } from "../expressions/regex.js";
import type { ExpressionStaticType } from "../schemas/expression.js";
import { referenceSchema, type ReferenceType } from "../schemas/reference.js";
import { prepareGrammarUpgradeSource } from "./grammarUpgradeSource.js";

/** Detectors are deliberately independent of the #756 version registry. The
 * registry supplies introducedIn, file-kind filtering, and the review footer. */
export const GRAMMAR_UPGRADE_IDS = [
  "prompt-blank-answers",
  "none-before-answers",
  "none-stage-termination",
  "text-comparison-normalization",
  "numeric-text-comparison",
  "strict-comparison-types",
  "regex-delimiter-parsing",
  "everyone-reference",
] as const;
export type GrammarUpgradeId = (typeof GRAMMAR_UPGRADE_IDS)[number];
export interface GrammarUpgradeHit {
  id: GrammarUpgradeId;
  path: ExpressionPath;
  message: string;
}
export interface GrammarUpgradeOptions {
  /** Optional metadata from the caller's per-treatment prompt type lookup.
   * Receives a canonical reference (legacy all is normalized to everyone) and
   * the source path of its reference field. Unknown types are never invented. */
  referenceType?: (
    reference: ReferenceType,
    path: ExpressionPath,
  ) => ExpressionStaticType | undefined;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const placeholder = (value: unknown) =>
  typeof value === "string" && /^\$\{[a-zA-Z0-9_]+\}$/.test(value);
const templateValue = (value: unknown): boolean =>
  typeof value === "string"
    ? /\$\{[a-zA-Z0-9_]+\}/.test(value)
    : Array.isArray(value) && value.some(templateValue);
const normalized = new Set([
  "equals",
  "doesNotEqual",
  "includes",
  "doesNotInclude",
  "isOneOf",
  "isNotOneOf",
]);
const negative = new Set([
  "doesNotEqual",
  "doesNotInclude",
  "doesNotMatch",
  "isNotOneOf",
]);
const ordered = new Set(["isAbove", "isBelow", "isAtLeast", "isAtMost"]);
const positive = new Set([
  "equals",
  "includes",
  "matches",
  "isOneOf",
  "hasLengthAtLeast",
  "hasLengthAtMost",
  ...ordered,
]);
const comparators = new Set([
  "exists",
  "doesNotExist",
  ...positive,
  ...negative,
]);

interface Site {
  value: unknown;
  path: ExpressionPath;
  kind: "condition" | "reference";
  stage: boolean;
}

/** Follow authoring schema roles, not arbitrary object properties. Templates
 * are visited at their definitions; invocation fields and literal data are
 * opaque. References used by display and outgoing URL fields are sites too. */
function* sites(
  value: unknown,
  view: (value: unknown) => unknown,
  kind = "file",
  path: ExpressionPath = [],
): Generator<Site> {
  if (kind === "condition" || kind === "conditions") {
    yield { value, path, kind: "condition", stage: false };
    return;
  }
  if (kind === "reference") {
    yield { value: view(value), path, kind: "reference", stage: false };
    return;
  }
  value = view(value);
  const itemKind: Record<string, string> = {
    treatments: "treatment",
    stages: "stage",
    elements: "element",
    introSteps: "introExitStep",
    exitSteps: "introExitStep",
    introSequences: "introSequence",
    groupComposition: "player",
    consent: "consentArm",
  };
  if (Object.hasOwn(itemKind, kind)) {
    if (Array.isArray(value))
      for (let i = 0; i < value.length; i++)
        yield* sites(value[i], view, itemKind[kind], [...path, i]);
    return;
  }
  if (!record(value) || "template" in value) return;
  if (kind === "file") {
    for (const key of ["treatments", "introSequences", "consent"])
      yield* sites(value[key], view, key, [...path, key]);
    if (Array.isArray(value.templates))
      for (let i = 0; i < value.templates.length; i++) {
        const template = view(value.templates[i]);
        if (
          record(template) &&
          typeof template.contentType === "string" &&
          template.contentType !== "file"
        )
          yield* sites(template.content, view, template.contentType, [
            ...path,
            "templates",
            i,
            "content",
          ]);
      }
    return;
  }
  if (
    ["stage", "introExitStep", "element", "player", "discussion"].includes(
      kind,
    ) &&
    "conditions" in value
  )
    yield {
      value: value.conditions,
      path: [...path, "conditions"],
      kind: "condition",
      stage: kind === "stage" || kind === "introExitStep",
    };
  const edges: Record<string, Record<string, string>> = {
    treatment: {
      gameStages: "stages",
      exitSequence: "exitSteps",
      groupComposition: "groupComposition",
    },
    introSequence: { introSteps: "introSteps" },
    consentArm: { steps: "introSteps" },
    stage: { elements: "elements", discussion: "discussion" },
    introExitStep: { elements: "elements" },
  };
  for (const [key, childKind] of Object.entries(
    Object.hasOwn(edges, kind) ? edges[kind] : {},
  ))
    yield* sites(value[key], view, childKind, [...path, key]);
  if (kind === "element") {
    if (value.type === "display")
      yield* sites(value.reference, view, "reference", [...path, "reference"]);
    if (
      (value.type === "trackedLink" || value.type === "qualtrics") &&
      Array.isArray(value.urlParams)
    )
      for (let i = 0; i < value.urlParams.length; i++) {
        const param = view(value.urlParams[i]);
        if (record(param))
          yield* sites(param.reference, view, "reference", [
            ...path,
            "urlParams",
            i,
            "reference",
          ]);
      }
  }
}

function describeReference(
  value: unknown,
): { reference: ReferenceType; legacy: boolean } | undefined {
  const legacy =
    typeof value === "string"
      ? value.startsWith("all.")
      : record(value) && value.position === "all";
  const canonical = legacy
    ? typeof value === "string"
      ? `everyone.${value.slice(4)}`
      : { ...(value as object), position: "everyone" }
    : value;
  const parsed = referenceSchema.safeParse(canonical);
  return parsed.success ? { reference: parsed.data, legacy } : undefined;
}

function scalarType(value: unknown): ExpressionStaticType | undefined {
  if (Array.isArray(value)) {
    const types = value.map(scalarType).filter((type) => type !== undefined);
    return types.length && types.every((type) => type === types[0])
      ? { list: types[0] }
      : undefined;
  }
  if (typeof value === "string" && !placeholder(value)) return "string";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}
const numericText = (value: unknown) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  !Number.isNaN(Number(value));
const typeName = (type: ExpressionStaticType) =>
  typeof type === "string"
    ? type
    : `list of ${typeof type.list === "string" ? type.list : "lists"}`;

function knownMismatch(
  left: ExpressionStaticType,
  right: ExpressionStaticType,
): boolean {
  if (
    left === "unknown" ||
    left === "missing" ||
    right === "unknown" ||
    right === "missing"
  )
    return false;
  if (typeof left === "object" && typeof right === "object")
    return knownMismatch(left.list, right.list);
  return left !== right;
}

/** Find behavior changes in one raw, unexpanded treatment file. No matching,
 * participant data, filesystem access, template expansion, or version policy. */
export function detectGrammarUpgrades(
  file: unknown,
  options: GrammarUpgradeOptions = {},
): GrammarUpgradeHit[] {
  const source = prepareGrammarUpgradeSource(file);
  const hits: GrammarUpgradeHit[] = [];
  const emitted = new Set<string>();
  const emit = (
    id: GrammarUpgradeId,
    path: ExpressionPath,
    message: string,
  ) => {
    const authoredPath = source.sourcePath(path);
    const key = JSON.stringify([id, authoredPath, message]);
    if (emitted.has(key)) return;
    emitted.add(key);
    hits.push({ id, path: authoredPath, message });
  };
  function groupReference(
    raw: unknown,
    path: ExpressionPath,
    comparator?: string,
  ): void {
    if (!describeReference(raw)?.legacy) return;
    const location = record(raw) ? [...path, "position"] : path;
    let message =
      "The reference position `all` is now `everyone`; group reads retain one slot per seat, including unanswered seats.";
    if (comparator === "exists")
      message +=
        " To preserve 'someone has answered', use `any:` around this leaf with the `everyone` reference.";
    else if (comparator === "doesNotExist" || negative.has(comparator ?? ""))
      message += ` Wrap this ${comparator} leaf in \`all:\` and use \`everyone\`: its meaning is preserved because missing seats satisfy the comparison; it does not wait for answers.`;
    else if (comparator)
      message += ` Wrap this ${comparator} leaf in \`all:\` and use \`everyone\`. This is stricter: every seat must now answer and satisfy the comparison, instead of checking only answered seats. The comparator still applies to each answer, not to the whole group list.`;
    emit("everyone-reference", location, message);
  }
  for (const site of sites(file, source.view)) {
    if (site.kind === "reference") {
      groupReference(site.value, site.path);
      continue;
    }
    const visits = [
      ...walkExpression(source.expression(site.value), {
        path: site.path,
        allowImplicitArray: true,
      }),
    ];
    const affectedNonePaths = new Set<string>();
    for (const visit of visits) {
      if (
        visit.kind !== "leaf" ||
        !record(visit.node) ||
        typeof visit.node.comparator !== "string" ||
        !positive.has(visit.node.comparator)
      )
        continue;
      for (const ancestor of visit.ancestors) {
        if (ancestor.operator === "none")
          affectedNonePaths.add(JSON.stringify(ancestor.path));
      }
    }
    for (const visit of visits) {
      if (!record(visit.node)) continue;
      const node = visit.node;
      if (
        visit.operator === "none" &&
        affectedNonePaths.has(JSON.stringify(visit.path))
      ) {
        emit(
          site.stage ? "none-stage-termination" : "none-before-answers",
          visit.path,
          site.stage
            ? "Missing positive comparisons now count as false inside `none:`. This can change whether a stage advances at load; review early termination using the whole condition tree, including surrounding operators and other operands."
            : "`none:` around a positive comparison can now be true before anyone answers. If this gate should wait, state the wait with `exists` checks or positive comparisons.",
        );
      }
      if (visit.kind === "reference") {
        groupReference(node.reference, [...visit.path, "reference"]);
        continue;
      }
      if (
        visit.kind !== "leaf" ||
        typeof node.comparator !== "string" ||
        !comparators.has(node.comparator)
      )
        continue;
      const reference = describeReference(node.reference);
      if (!reference) continue;
      const comparator = node.comparator;
      const value = node.value;
      const deferredValue = templateValue(value);
      const refPath = [...visit.path, "reference"];
      groupReference(node.reference, refPath, comparator);
      const promptAnswer =
        reference.reference.source === "prompt" &&
        (reference.reference.path === undefined ||
          (reference.reference.path.length === 1 &&
            reference.reference.path[0] === "value"));
      const blank = (item: unknown) =>
        item === null ||
        (typeof item === "string" && item.trim() === "") ||
        (Array.isArray(item) && item.length === 0);
      if (
        promptAnswer &&
        (comparator === "exists" ||
          comparator === "doesNotExist" ||
          comparator === "hasLengthAtMost" ||
          comparator === "hasLengthAtLeast" ||
          comparator === "matches" ||
          comparator === "doesNotMatch" ||
          (normalized.has(comparator) &&
            (deferredValue ||
              blank(value) ||
              (Array.isArray(value) && value.some(blank)))))
      )
        emit(
          "prompt-blank-answers",
          visit.path,
          `This prompt ${comparator} condition now treats empty text, whitespace-only text, and an empty selection as Missing. They no longer count as answers or satisfy positive length/comparison checks. Use exists/doesNotExist to test answer presence; null comparison values are no longer allowed.${deferredValue ? " Review the template's supplied values at each invocation." : ""}`,
        );
      let knownType = options.referenceType?.(
        reference.reference,
        source.sourcePath(refPath),
      );
      if (
        reference.reference.position === "everyone" &&
        typeof knownType === "object"
      )
        knownType = knownType.list;
      const texts = (Array.isArray(value) ? value : [value]).some(
        (item) => typeof item === "string",
      );
      if (
        normalized.has(comparator) &&
        texts &&
        knownType !== "number" &&
        knownType !== "boolean"
      )
        emit(
          "text-comparison-normalization",
          visit.path,
          `Text used by ${comparator} now ignores case and surrounding spaces (trim, then lowercase), including negative comparisons. Review labels and free-text distinctions; internal whitespace is unchanged.${deferredValue ? " This template may supply text values, so review its invocations." : ""}`,
        );
      if (
        (comparator === "equals" || comparator === "doesNotEqual") &&
        (numericText(value) || deferredValue) &&
        knownType !== "number"
      )
        emit(
          "numeric-text-comparison",
          [...visit.path, "value"],
          `${deferredValue ? "If this template supplies numeric-looking text, review its comparisons: two" : "Two"} numeric-looking strings in ${comparator} are now compared as text: "100.00" and "100" differ, as do "007" and "7". Numeric coercion no longer makes these spellings equal.`,
        );
      const expected = scalarType(value);
      let comparedType = knownType;
      let targetType = expected;
      if (comparator === "isOneOf" || comparator === "isNotOneOf")
        targetType = typeof expected === "object" ? expected.list : undefined;
      if (comparator === "includes" || comparator === "doesNotInclude")
        comparedType =
          typeof knownType === "object" ? knownType.list : knownType;
      const comparable = normalized.has(comparator) || ordered.has(comparator);
      const concrete =
        comparedType !== undefined &&
        comparedType !== "unknown" &&
        comparedType !== "missing";
      if (comparable && deferredValue) {
        emit(
          "strict-comparison-types",
          visit.path,
          `Review this template's supplied values for ${comparator}: different known comparison types are now a validation error. Numeric-looking text is not converted to a number. Match each supplied value's type to the stored answer; see https://github.com/talkbench/stagebook/blob/main/docs/researcher/conditions.md#prompts-that-save-numbers.`,
        );
      } else if (
        comparable &&
        targetType !== undefined &&
        concrete &&
        knownMismatch(comparedType!, targetType)
      ) {
        emit(
          "strict-comparison-types",
          visit.path,
          `This ${comparator} comparison uses a ${typeName(comparedType!)} reference and a ${typeName(targetType)} value; different known types are now a validation error. Text is not converted to a number, and a number is not converted to a quoted string. Match the value's type to the stored answer; see https://github.com/talkbench/stagebook/blob/main/docs/researcher/conditions.md#prompts-that-save-numbers.`,
        );
      } else if (
        comparable &&
        !concrete &&
        (typeof value === "number" || numericText(value))
      ) {
        emit(
          "strict-comparison-types",
          visit.path,
          typeof value === "number"
            ? `Numeric coercion is gone for ${comparator}. If this reference saves text, comparing it with this number is now a type error; quote a text value or use a prompt that saves numbers.`
            : `Numeric coercion is gone for ${comparator}. If this reference saves a number, comparing it with this quoted numeric string is now a type error; use an unquoted numeric value.`,
        );
      } else if (
        ordered.has(comparator) &&
        (knownType === "string" || expected === "string")
      ) {
        emit(
          "strict-comparison-types",
          visit.path,
          `${comparator} now requires numbers on both sides; numeric-looking text is not converted, and known text operands are a validation error. Use a prompt that saves numbers.`,
        );
      }
      if (
        (comparator === "matches" || comparator === "doesNotMatch") &&
        typeof value === "string"
      ) {
        const parsed = parseRegexLiteral(value);
        const previous = value
          .split("/")
          .filter((part) => part !== "")
          .join("/");
        if (
          deferredValue ||
          !parsed ||
          parsed.pattern !== previous ||
          parsed.flags !== ""
        )
          emit(
            "regex-delimiter-parsing",
            [...visit.path, "value"],
            `${comparator} now parses /pattern/flags as a pattern plus flags, preserving internal slashes. ${deferredValue ? "The template may supply affected patterns or flags; review its invocations." : "The old slash-stripping behavior changed this expression."} Review delimiters and flags; only i, s, and u are supported.`,
          );
      }
    }
  }
  return hits.sort(
    (a, b) =>
      GRAMMAR_UPGRADE_IDS.indexOf(a.id) - GRAMMAR_UPGRADE_IDS.indexOf(b.id),
  );
}

/** Adapt each descriptor to #756 with appliesTo: ["treatment"], its release,
 * and detect: input => input.kind === "treatment" ? rule.detect(input.file) : []. */
export const grammarUpgradeDetectors = GRAMMAR_UPGRADE_IDS.map((id) => ({
  id,
  detect: (
    file: unknown,
    options?: GrammarUpgradeOptions,
  ): Omit<GrammarUpgradeHit, "id">[] =>
    detectGrammarUpgrades(file, options)
      .filter((hit) => hit.id === id)
      .map(({ path, message }) => ({ path, message })),
}));
