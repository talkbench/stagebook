import { z } from "zod";
import type { SafeParseReturnType, ZodIssue } from "zod";
import {
  getValidKeysForComparator,
  getValidKeysForDiscussion,
  getValidKeysForElementType,
  getValidKeysForIntroExitStep,
  getValidKeysForPlayer,
  getValidKeysForStage,
  getValidKeysForTreatment,
  treatmentFileSchema,
  type TreatmentFileType,
} from "./treatment.js";

/**
 * Structured params attached to enriched `unrecognized_keys` issues.
 *
 * The wrapper rewrites each Zod `unrecognized_keys` issue as a
 * `z.ZodIssueCode.custom` issue with this shape on `params`, so
 * downstream consumers (VS Code quick-fix, viewer error UI) can read
 * the suggestion + valid-keys list without re-parsing the message.
 *
 * `validKeys` is `null` when the container kind couldn't be identified
 * from the issue path (the diagnostic text in that case is the bare
 * "Unrecognized key 'X'." form with no key list).
 */
export interface UnrecognizedKeyIssueParams {
  badKey: string;
  suggestion: string | null;
  validKeys: string[] | null;
}

/**
 * Per-container-kind label used when describing the bad key's location
 * in the human-readable diagnostic message ("element of type 'mediaPlayer'",
 * "stage", etc.).
 */
type ContainerLabel =
  | { kind: "element"; type: string }
  | { kind: "condition"; comparator: string }
  | { kind: "stage" }
  | { kind: "introExitStep" }
  | { kind: "treatment" }
  | { kind: "discussion" }
  | { kind: "player" }
  | { kind: "unknown" };

const DEFAULT_MAX_DISTANCE = 5;

/**
 * Levenshtein edit distance — single-row DP, O(min(m,n)) space. Kept
 * inline rather than imported from `apps/vscode/src/lib/levenshtein` so
 * the stagebook library has no dependency on the VS Code extension
 * package (the viewer also calls `safeParseTreatmentFile`). Behavior
 * matches that helper exactly: distance < maxDistance is a match.
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  let prev = Array.from({ length: shorter.length + 1 }, (_, i) => i);

  for (let i = 1; i <= longer.length; i++) {
    const curr = [i];
    for (let j = 1; j <= shorter.length; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }

  return prev[shorter.length];
}

function findClosestMatch(
  target: string,
  candidates: string[],
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): string | null {
  let bestMatch: string | null = null;
  let bestDistance = maxDistance + 1;

  for (const candidate of candidates) {
    const distance = levenshtein(target, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  return bestDistance < maxDistance ? bestMatch : null;
}

/**
 * Walk the parsed object at `path` and return whatever sits there
 * (used to discover the parent container's `type` / `comparator`
 * discriminator when the issue path leads to that container).
 */
function getAtPath(root: unknown, path: (string | number)[]): unknown {
  let cur: unknown = root;
  for (const segment of path) {
    if (cur == null) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[segment];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Inspect the path/parent to figure out which named-export valid-keys
 * helper applies. The treatmentFileSchema tree is shallow enough that
 * we can identify the container kind from the path's structure (which
 * keys appear at each depth), occasionally consulting the parsed value
 * to read a `type` or `comparator` discriminator.
 *
 * Returns `{ kind: "unknown" }` when the path doesn't land on one of
 * the named containers — caller falls back to a no-key-list message.
 *
 * Path shapes recognized:
 * - element     : … "elements" <number>             (any depth)
 * - condition   : … "conditions" <number>           (any depth)
 * - stage       : "treatments" <n> "gameStages" <n>
 * - introExitStep: "introSequences" <n> "introSteps" <n>
 *               | … "exitSequence" <n>
 * - treatment   : "treatments" <n>
 * - discussion  : … "discussion"
 * - player      : … "groupComposition" <n>
 *
 * NOT recognized today: template `content` paths. Unrecognized keys
 * inside a template body fall through to the `unknown` bucket and
 * surface with a bare "Unrecognized key 'X'." (no key list, no
 * suggestion). Resolving these would require walking back up the path
 * to the enclosing `templates[n]`, reading its `contentType`, and
 * dispatching to the matching getValidKeysFor* helper. Out of scope
 * for #123; would land as a follow-up if researchers actually hit it.
 *
 * `path` here is the path *to the container* (i.e. the issue.path —
 * which in `unrecognized_keys` issues already points at the parent of
 * the bad key, not the bad key itself).
 */
function classifyContainer(
  path: (string | number)[],
  root: unknown,
): ContainerLabel {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  // element: parent path ends with `…elements <index>`.
  if (typeof last === "number" && secondLast === "elements") {
    const value = getAtPath(root, path);
    const type =
      value && typeof value === "object" && "type" in value
        ? (value as { type?: unknown }).type
        : undefined;
    return {
      kind: "element",
      type: typeof type === "string" ? type : "",
    };
  }

  // condition: parent path ends with `…conditions <index>`.
  if (typeof last === "number" && secondLast === "conditions") {
    const value = getAtPath(root, path);
    const comparator =
      value && typeof value === "object" && "comparator" in value
        ? (value as { comparator?: unknown }).comparator
        : undefined;
    return {
      kind: "condition",
      comparator: typeof comparator === "string" ? comparator : "",
    };
  }

  // stage: `treatments[n].gameStages[m]`.
  if (
    typeof last === "number" &&
    secondLast === "gameStages" &&
    path[0] === "treatments"
  ) {
    return { kind: "stage" };
  }

  // intro/exit step: `introSequences[n].introSteps[m]` or
  // `treatments[n].exitSequence[m]`.
  if (typeof last === "number" && secondLast === "introSteps") {
    return { kind: "introExitStep" };
  }
  if (typeof last === "number" && secondLast === "exitSequence") {
    return { kind: "introExitStep" };
  }

  // treatment: `treatments[n]` (and only that — not deeper).
  if (typeof last === "number" && secondLast === "treatments") {
    return { kind: "treatment" };
  }

  // discussion: any path whose final segment is `discussion`.
  if (last === "discussion") {
    return { kind: "discussion" };
  }

  // player: `…groupComposition[n]`.
  if (typeof last === "number" && secondLast === "groupComposition") {
    return { kind: "player" };
  }

  return { kind: "unknown" };
}

function validKeysFor(label: ContainerLabel): string[] | null {
  switch (label.kind) {
    case "element":
      return getValidKeysForElementType(label.type);
    case "condition":
      return getValidKeysForComparator(label.comparator);
    case "stage":
      return getValidKeysForStage();
    case "introExitStep":
      return getValidKeysForIntroExitStep();
    case "treatment":
      return getValidKeysForTreatment();
    case "discussion":
      return getValidKeysForDiscussion();
    case "player":
      return getValidKeysForPlayer();
    case "unknown":
      return null;
  }
}

function describeContainer(label: ContainerLabel): string | null {
  switch (label.kind) {
    case "element":
      return label.type ? `element of type '${label.type}'` : "element";
    case "condition":
      return label.comparator
        ? `condition with comparator '${label.comparator}'`
        : "condition";
    case "stage":
      return "stage";
    case "introExitStep":
      return "intro/exit step";
    case "treatment":
      return "treatment";
    case "discussion":
      return "discussion";
    case "player":
      return "player block";
    case "unknown":
      return null;
  }
}

function buildMessage(
  badKey: string,
  containerLabel: string | null,
  validKeys: string[] | null,
  suggestion: string | null,
): string {
  if (!containerLabel || !validKeys) {
    return `Unrecognized key '${badKey}'.`;
  }
  const validList = validKeys.join(", ");
  if (suggestion) {
    return `Unrecognized key '${badKey}' on ${containerLabel}. Did you mean '${suggestion}'? Valid keys: ${validList}`;
  }
  return `Unrecognized key '${badKey}' on ${containerLabel}. Valid keys: ${validList}`;
}

/**
 * Rewrite a single Zod `unrecognized_keys` issue into one custom issue
 * per bad key, each carrying a rich human-readable message and the
 * structured `params: UnrecognizedKeyIssueParams`. The custom issues'
 * `path` includes the bad key as the final segment, so position
 * mappers can land squiggles directly on the offending key.
 */
function rewriteUnrecognizedKeysIssue(
  issue: ZodIssue,
  parsedInput: unknown,
): ZodIssue[] {
  if (issue.code !== z.ZodIssueCode.unrecognized_keys) return [issue];

  const containerLabel = classifyContainer(issue.path, parsedInput);
  const validKeys = validKeysFor(containerLabel);
  const description = describeContainer(containerLabel);

  return issue.keys.map((badKey) => {
    const suggestion = validKeys ? findClosestMatch(badKey, validKeys) : null;

    const params: UnrecognizedKeyIssueParams = {
      badKey,
      suggestion,
      validKeys,
    };

    // Use ZodIssueCode.custom so the issue can carry structured params
    // (Zod's built-in `unrecognized_keys` code has no `params` field).
    // Path ends at the bad key. The VS Code extension detects these
    // issues via `params.badKey` and uses the position mapper's
    // `resolveKey()` method to land the squiggle on the key token
    // itself; consumers that don't have a key-token resolver fall back
    // to the parent's value range via path-walking.
    return {
      code: z.ZodIssueCode.custom,
      path: [...issue.path, badKey],
      message: buildMessage(badKey, description, validKeys, suggestion),
      params: params as unknown as Record<string, unknown>,
    };
  });
}

/**
 * Validate a treatment-file-shaped value against `treatmentFileSchema`
 * and rewrite each `unrecognized_keys` issue with a rich
 * "Unrecognized key 'X' on …. Did you mean 'Y'? Valid keys: …" message.
 *
 * - Splits a single Zod issue containing N bad keys into N separate
 *   issues, so each squiggle lands on the specific bad key.
 * - Attaches structured `params: { badKey, suggestion, validKeys }` to
 *   each rewritten issue (consumers like the VS Code quick-fix read
 *   these without re-parsing the message).
 * - Falls back to a bare "Unrecognized key 'X'." (no suggestion, no
 *   list) when the path doesn't resolve to one of the recognized
 *   containers.
 *
 * Other Zod issues pass through unchanged.
 */
export function safeParseTreatmentFile(
  input: unknown,
): SafeParseReturnType<unknown, TreatmentFileType> {
  const result = treatmentFileSchema.safeParse(input);
  if (result.success) return result;

  const rewrittenIssues: ZodIssue[] = [];
  for (const issue of result.error.issues) {
    rewrittenIssues.push(...rewriteUnrecognizedKeysIssue(issue, input));
  }

  return {
    success: false,
    error: new z.ZodError(rewrittenIssues),
  } as SafeParseReturnType<unknown, TreatmentFileType>;
}
