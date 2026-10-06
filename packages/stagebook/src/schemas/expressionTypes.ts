import {
  walkExpression,
  type ExpressionPath,
} from "../expressions/walkExpression.js";
import {
  createExpressionSchemas,
  type ExpressionStaticType,
} from "./expression.js";
import { promptValueType, type PromptFileType } from "./promptFile.js";
import { referenceSchema } from "./reference.js";
import { hostReferenceType } from "./hostReferenceTypes.js";

export type UnknownExpressionTypeReason =
  | "missingSourceSchema"
  | "unknownHostField"
  | "unknownPromptField"
  | "unreadablePrompt"
  | "missingProducer"
  | "disagreeingProducers";

export interface ExpressionTypeIssue {
  path: ExpressionPath;
  severity: "error" | "warning";
  message: string;
  reason?: UnknownExpressionTypeReason;
}

interface ReferenceDescription {
  position: string | number;
  source: string;
  name?: string;
  path?: readonly string[];
}
interface ReferenceTypeResult {
  type: ExpressionStaticType;
  reason?: UnknownExpressionTypeReason;
  detail?: string;
  error?: string;
}
interface ConditionSite {
  conditions: unknown;
  path: ExpressionPath;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

function describeReference(input: unknown): ReferenceDescription | undefined {
  const parsed = referenceSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

function referenceLabel(reference: ReferenceDescription): string {
  return [
    reference.position,
    reference.source,
    reference.name,
    ...(reference.path ?? []),
  ]
    .filter((part) => part !== undefined)
    .join(".");
}

function* stageConditions(
  stages: unknown,
  base: ExpressionPath,
): Generator<ConditionSite> {
  const items = array(stages);
  for (let i = 0; i < items.length; i++) {
    const stage = items[i];
    if (!record(stage)) continue;
    const path = [...base, i];
    if (own(stage, "conditions"))
      yield { conditions: stage.conditions, path: [...path, "conditions"] };
    if (record(stage.discussion) && own(stage.discussion, "conditions")) {
      yield {
        conditions: stage.discussion.conditions,
        path: [...path, "discussion", "conditions"],
      };
    }
    const elements = array(stage.elements);
    for (let j = 0; j < elements.length; j++) {
      const element = elements[j];
      if (record(element) && own(element, "conditions")) {
        yield {
          conditions: element.conditions,
          path: [...path, "elements", j, "conditions"],
        };
      }
    }
  }
}

/** Shared answers and player answers live in distinct stores. */
function producerKey(name: string, shared: boolean): string {
  return JSON.stringify([shared ? "shared" : "player", name]);
}
function addProducers(stages: unknown, files: Map<string, Set<string>>): void {
  for (const stage of array(stages)) {
    if (!record(stage)) continue;
    for (const element of array(stage.elements)) {
      if (
        !record(element) ||
        element.type !== "prompt" ||
        typeof element.name !== "string" ||
        typeof element.file !== "string"
      )
        continue;
      const key = producerKey(element.name, element.shared === true);
      const paths = files.get(key) ?? new Set<string>();
      paths.add(element.file);
      files.set(key, paths);
    }
  }
}

function promptType(
  type: ReturnType<typeof promptValueType>,
): ExpressionStaticType {
  return type === "string[]" ? { list: "string" } : (type ?? "missing");
}
function lookupReferenceType(
  reference: ReferenceDescription,
  producers: ReadonlyMap<string, Set<string>>,
  prompts: ReadonlyMap<string, PromptFileType>,
): ReferenceTypeResult {
  const withGroup = (value: ReferenceTypeResult): ReferenceTypeResult => ({
    ...value,
    type: reference.position === "everyone" ? { list: value.type } : value.type,
  });
  const unknown = (reason: UnknownExpressionTypeReason, detail: string) =>
    withGroup({ type: "unknown", reason, detail });
  if (reference.source !== "prompt") {
    const host = hostReferenceType(reference.source, reference.path ?? []);
    if (host?.kind === "known") return withGroup({ type: host.type });
    if (host?.kind === "unknown")
      return unknown("unknownHostField", host.detail);
    if (host?.kind === "invalid")
      return withGroup({ type: "unknown", error: host.detail });
    return unknown(
      "missingSourceSchema",
      `no expression type schema is available for source ${reference.source}`,
    );
  }
  const path = reference.path ?? ["value"];
  if (path[0] !== "value") {
    return unknown(
      "unknownPromptField",
      "only prompt .value has a declared expression type in this version",
    );
  }
  if (!reference.name)
    return unknown(
      "missingProducer",
      "the prompt producer could not be identified",
    );
  const files = producers.get(
    producerKey(reference.name, reference.position === "shared"),
  );
  if (!files?.size)
    return unknown(
      "missingProducer",
      "no prompt producer in this treatment or its compatible intro sequences provides a known type",
    );
  const types: ExpressionStaticType[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    const prompt = prompts.get(file);
    if (!prompt) unreadable.push(file);
    else types.push(promptType(promptValueType(prompt)));
  }
  if (unreadable.length)
    return unknown(
      "unreadablePrompt",
      `prompt file${unreadable.length === 1 ? "" : "s"} could not be read or parsed: ${unreadable.join(", ")}`,
    );
  if (new Set(types.map((type) => JSON.stringify(type))).size > 1) {
    return unknown(
      "disagreeingProducers",
      `prompt producers disagree about the answer type: ${[...files].join(", ")}`,
    );
  }
  let type = types[0];
  for (const segment of path.slice(1)) {
    if ((typeof type === "object" || type === "string") && segment === "length")
      type = "number";
    else if (typeof type === "object" && /^(0|[1-9]\d*)$/.test(segment))
      type = type.list;
    else if (type === "string" && /^(0|[1-9]\d*)$/.test(segment))
      type = "string";
    else
      return withGroup({
        type: "unknown",
        error:
          "the path cannot be traversed through the declared prompt answer type",
      });
  }
  return withGroup({ type });
}

/** Post-hydration type checking, pure over the host's parsed prompt map.
 * Warnings stay outside Zod: gradual typing never changes safeParse success.
 * Names are scoped per treatment (plus its compatible intros), per standalone
 * intro sequence, and per consent arm; unused template bodies are not studies. */
export function checkExpressionTypes(
  fileObj: unknown,
  prompts: ReadonlyMap<string, PromptFileType>,
): ExpressionTypeIssue[] {
  if (!record(fileObj)) return [];
  const issues: ExpressionTypeIssue[] = [];
  const collections = [
    { key: "treatments", lists: ["gameStages", "exitSequence"] },
    { key: "introSequences", lists: ["introSteps"] },
    { key: "consent", lists: ["steps"] },
  ];
  const baseSchema = createExpressionSchemas({
    mode: "resolved",
  }).conditionsSchema;
  for (const { key, lists } of collections) {
    array(fileObj[key]).forEach((container, index) => {
      if (!record(container)) return;
      const producers = new Map<string, Set<string>>();
      for (const list of lists) addProducers(container[list], producers);
      if (key === "treatments") {
        const pairing = container.compatibleIntroSequences;
        const concrete =
          Array.isArray(pairing) &&
          pairing.every(
            (name: unknown) => typeof name === "string" && !name.includes("${"),
          );
        for (const sequence of array(fileObj.introSequences)) {
          if (
            !record(sequence) ||
            (concrete && !pairing.includes(sequence.name))
          )
            continue;
          addProducers(sequence.introSteps, producers);
        }
      }
      const lookup = (input: unknown) => {
        const ref = describeReference(input);
        return ref ? lookupReferenceType(ref, producers, prompts) : undefined;
      };
      const schema = createExpressionSchemas({
        mode: "resolved",
        referenceType: (reference) => lookup(reference)?.type,
      }).conditionsSchema;
      const sites: ConditionSite[] = lists.flatMap((list) => [
        ...stageConditions(container[list], [key, index, list]),
      ]);
      if (key === "treatments") {
        array(container.groupComposition).forEach((player, playerIndex) => {
          if (record(player) && own(player, "conditions"))
            sites.push({
              conditions: player.conditions,
              path: [key, index, "groupComposition", playerIndex, "conditions"],
            });
        });
      }
      for (const site of sites) {
        // Structural errors already belong to the authoring/resolved schemas.
        // Report only errors introduced by the loaded reference type evidence.
        const baseline = baseSchema.safeParse(site.conditions);
        const baselineErrors = new Set(
          baseline.success
            ? []
            : baseline.error.issues.map((issue) =>
                JSON.stringify([issue.path, issue.message]),
              ),
        );
        const checked = schema.safeParse(site.conditions);
        if (!checked.success) {
          for (const issue of checked.error.issues) {
            if (baselineErrors.has(JSON.stringify([issue.path, issue.message])))
              continue;
            issues.push({
              path: [...site.path, ...issue.path],
              severity: "error",
              message: `${issue.message} For text/number comparisons, quote text values or use a prompt that saves numbers: https://github.com/talkbench/stagebook/blob/main/docs/researcher/conditions.md#prompts-that-save-numbers`,
            });
          }
        }
        for (const visit of walkExpression(site.conditions, {
          allowImplicitArray: true,
        })) {
          if (
            (visit.kind !== "reference" && visit.kind !== "leaf") ||
            !record(visit.node)
          )
            continue;
          const ref = describeReference(visit.node.reference);
          if (!ref) continue;
          const type = lookupReferenceType(ref, producers, prompts);
          if (type.error) {
            issues.push({
              path: [...site.path, ...visit.path, "reference"],
              severity: "error",
              message: `Reference \`${referenceLabel(ref)}\` has an invalid path: ${type.error}.`,
            });
            continue;
          }
          if (!type.reason) continue;
          issues.push({
            path: [...site.path, ...visit.path, "reference"],
            severity: "warning",
            reason: type.reason,
            message: `Reference \`${referenceLabel(ref)}\` has an unknown type: ${type.detail}. Its type will be checked at runtime.`,
          });
        }
      }
    });
  }
  return issues;
}
