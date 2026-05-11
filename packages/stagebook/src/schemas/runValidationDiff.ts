import type { ZodIssue } from "zod";
import { load as loadYaml } from "js-yaml";
import { fillTemplates } from "../templates/fillTemplates.js";
import { safeParseTreatmentFile } from "./safeParseTreatmentFile.js";

/**
 * Diff-based validation orchestrator.
 *
 * Runs the schema twice — once on the unfilled source object, once on
 * the hydrated form (`fillTemplates({ allowUnresolved: true })`) — and
 * partitions the issues by which run(s) they appeared in:
 *
 *   matched      Issues in both runs. The source-pass instance has a
 *                source position; the hydrated-pass instance confirms
 *                the bug isn't a pre-fill artifact. Real bug.
 *
 *   sourceOnly   Issues only in the source pass. v1 can't reliably
 *                tell artifacts apart from real bugs here. Two
 *                independent mechanisms can land issues in this
 *                bucket:
 *
 *                  - true templating artifacts. The canonical example
 *                    is the intro/exit "needs advancement element"
 *                    refinement firing on a `template:` invocation
 *                    that expands to a submitButton. Path is usually
 *                    inside `treatments`/`introSequences`, but can
 *                    also land inside `templates[...]` when a
 *                    template's content has `contentType:
 *                    introExitStep` (or similar) and the inner
 *                    refinement fires on its own pre-fill view of
 *                    the elements list.
 *
 *                  - real bugs that didn't survive hydration into a
 *                    matched pair. The most common: an unused
 *                    template definition with a schema-level error
 *                    (no invocation → no hydrated counterpart → no
 *                    match). Path is inside `templates[...]`.
 *
 *                Path alone isn't a reliable discriminator (the
 *                advancement-element case puts an artifact at a
 *                `templates`-prefixed path). v1 callers should
 *                surface sourceOnly at a lower visual priority than
 *                matched/hydratedOnly (e.g., as warnings or expanded
 *                on demand) rather than as hard errors, since some
 *                fraction WILL be artifacts. Provenance-aware
 *                matching (option 2/3 in #321) would eliminate this
 *                ambiguity.
 *
 *   hydratedOnly Issues only in the hydrated pass. Bug that only
 *                surfaces after expansion (e.g., a field-substituted
 *                value violating a constraint, or a used template's
 *                def error replicated at each expansion site). The
 *                source position is harder to pin without provenance,
 *                so callers typically display these at the invocation
 *                site or in the expanded preview. Note that a used
 *                template's def-error produces a `matched` entry at
 *                the def site plus N-1 `hydratedOnly` entries at the
 *                expansion sites — same bug, callers can de-dupe by
 *                (code, normalized_message).
 *
 * Matching is by `(code, normalized_message)`. Coincidentally
 * identical issue text at different paths collapses — acceptable for
 * v1. Options 2 (path-aware match) and 3 (full provenance) are
 * tracked in #321 for when this becomes the bottleneck.
 *
 * When YAML parsing or hydration fails, `hydrationError` is set, the
 * hydrated pass and the diff buckets stay empty, and callers fall
 * back to `sourceIssues` (which may include templating artifacts —
 * the diff can't tell them apart without a hydrated counterpart).
 *
 * Imports (post-`resolveImports`) are passed in via
 * `importedTemplates` and merged into both passes. Callers without
 * imports omit it.
 *
 * See #321 for the broader pipeline this powers.
 */

export interface ValidationDiffInput {
  /** Raw treatment YAML source. */
  source: string;
  /**
   * Templates contributed by imports (post-`resolveImports`). Merged
   * into the source's `templates:` array for both validation passes.
   */
  importedTemplates?: unknown[];
}

export interface ValidationDiffResult {
  /**
   * YAML-parse or hydration error message, or null when both succeeded.
   * When set, the diff buckets are empty and `sourceIssues` is the
   * caller's only signal.
   */
  hydrationError: string | null;
  /** Schema issues from the source-pass run. Always populated when the YAML parsed. */
  sourceIssues: ZodIssue[];
  /** Schema issues from the hydrated-pass run. Empty when hydration failed. */
  hydratedIssues: ZodIssue[];
  /** Issues that appeared in both passes — real bugs. */
  matched: ZodIssue[];
  /** Issues only in the source pass — templating artifacts. */
  sourceOnly: ZodIssue[];
  /** Issues only in the hydrated pass — revealed by expansion. */
  hydratedOnly: ZodIssue[];
}

/**
 * Build the key used to match issues across the two passes. Lossy by
 * design — different paths with the same `(code, message)` collapse
 * — but the alternative (path-aware matching) requires tracking
 * template provenance through hydration, which is a separate piece
 * of work (#321 option 2 / 3).
 *
 * Strips the `Invalid content for contentType 'X': ` prefix that the
 * template schema's superRefine prepends when validating template
 * content against the contentType-keyed sub-schema (treatment.ts).
 * Without that strip, the source-pass message ("Invalid content for
 * contentType 'stage': Invalid discriminator value...") wouldn't
 * match the hydrated-pass message ("Invalid discriminator value...")
 * for the same underlying error.
 *
 * Exported so consumers and tests can sanity-check the canonical form
 * directly.
 */
export function normalizeIssueKey(issue: ZodIssue): string {
  return `${issue.code}|${stripTemplateContentPrefix(issue.message)}`;
}

const TEMPLATE_CONTENT_PREFIX_RE = /^Invalid content for contentType '[^']+': /;

function stripTemplateContentPrefix(message: string): string {
  return message.replace(TEMPLATE_CONTENT_PREFIX_RE, "");
}

export function runValidationDiff({
  source,
  importedTemplates = [],
}: ValidationDiffInput): ValidationDiffResult {
  const empty: ValidationDiffResult = {
    hydrationError: null,
    sourceIssues: [],
    hydratedIssues: [],
    matched: [],
    sourceOnly: [],
    hydratedOnly: [],
  };

  let parsed: unknown;
  try {
    // `js-yaml` (browser-safe, no `process` deps) — matches the rest
    // of stagebook. The `yaml` package would pull in process-touching
    // code that breaks the VS Code webview bundle.
    parsed = loadYaml(source);
  } catch (e) {
    return {
      ...empty,
      hydrationError: `YAML parse error: ${errorMessage(e)}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ...empty,
      hydrationError:
        "Treatment file must be a YAML mapping (object), not a scalar or array.",
    };
  }

  const root = parsed as Record<string, unknown>;

  // Build the merged object used for both passes. Preserve every
  // field from `root` exactly as-authored — the schema does its own
  // type checking, and silently coercing (e.g., turning a non-array
  // `templates:` into `[]`) would mask the original type error.
  // Imports stay on the object too: the schema models `imports:` and
  // would otherwise miss type errors there (e.g., non-string entries).
  const merged: Record<string, unknown> = { ...root };

  // Merging policy:
  //   - root.templates is absent → use just importedTemplates
  //   - root.templates is an array → merge with importedTemplates
  //   - root.templates exists but isn't an array → leave it alone so
  //     Zod flags the type error; ignore importedTemplates (the user
  //     needs to fix the type before imports become reachable anyway)
  const rootTemplatesField = root.templates;
  const rootHasTemplates = "templates" in root;
  const rootTemplatesAreArray = Array.isArray(rootTemplatesField);
  const rootTemplatesInvalid = rootHasTemplates && !rootTemplatesAreArray;

  let mergedTemplates: unknown[] | null = null;
  if (!rootTemplatesInvalid) {
    mergedTemplates = [];
    if (rootTemplatesAreArray) {
      for (const tmpl of rootTemplatesField) mergedTemplates.push(tmpl);
    }
    for (const tmpl of importedTemplates) mergedTemplates.push(tmpl);
    if (rootHasTemplates || importedTemplates.length > 0) {
      merged.templates = mergedTemplates;
    }
  }

  // Source pass — validate the unfilled merged object.
  const sourceResult = safeParseTreatmentFile(merged);
  const sourceIssues = sourceResult.success
    ? []
    : [...sourceResult.error.issues];

  // Hydrate. fillTemplates({ allowUnresolved: true }) leaves
  // unbound `${field}` placeholders intact as literals, which is
  // what we want — host-fill runtime values stay as strings, and
  // the schema's reference checker treats them as the wildcard set
  // (see `unresolvedFields` discussion in #321).
  //
  // fillTemplates needs a real array — pass an empty list when
  // root's templates was malformed.
  let expanded: Record<string, unknown>;
  try {
    const fillResult: { result: unknown } = fillTemplates({
      obj: merged,
      templates: mergedTemplates ?? [],
      allowUnresolved: true,
    });
    expanded = fillResult.result as Record<string, unknown>;
  } catch (e) {
    return {
      hydrationError: `Template expansion failed: ${errorMessage(e)}`,
      sourceIssues,
      hydratedIssues: [],
      matched: [],
      sourceOnly: [],
      hydratedOnly: [],
    };
  }

  // The hydrated pass deliberately sees the post-fill runtime shape:
  // fillTemplates strips `templates:`, and we leave it stripped. The
  // ambiguous-sourceOnly note in the function header explains why
  // path-based routing isn't sufficient and what callers should do
  // with the bucket.
  //
  // imports stays naturally — fillTemplates only strips `templates:`,
  // not `imports:` — so the schema's import-list type check runs in
  // both passes and routes via the normal diff.

  // Hydrated pass — validate the expanded object.
  const hydratedResult = safeParseTreatmentFile(expanded);
  const hydratedIssues = hydratedResult.success
    ? []
    : [...hydratedResult.error.issues];

  const { matched, sourceOnly, hydratedOnly } = diffIssues(
    sourceIssues,
    hydratedIssues,
  );

  return {
    hydrationError: null,
    sourceIssues,
    hydratedIssues,
    matched,
    sourceOnly,
    hydratedOnly,
  };
}

/**
 * Multiset diff over `(code, normalized_message)` keys. For each key,
 * the first `min(s, h)` source-side issues are "matched" (paired with
 * a hydrated counterpart); the leftover on each side goes to the
 * source-only or hydrated-only bucket. Source-side issue objects are
 * preserved for the matched bucket so callers can use their source
 * positions.
 */
function diffIssues(
  sourceIssues: ZodIssue[],
  hydratedIssues: ZodIssue[],
): {
  matched: ZodIssue[];
  sourceOnly: ZodIssue[];
  hydratedOnly: ZodIssue[];
} {
  const hydratedCountByKey = new Map<string, number>();
  for (const issue of hydratedIssues) {
    const key = normalizeIssueKey(issue);
    hydratedCountByKey.set(key, (hydratedCountByKey.get(key) ?? 0) + 1);
  }

  const matched: ZodIssue[] = [];
  const sourceOnly: ZodIssue[] = [];
  for (const issue of sourceIssues) {
    const key = normalizeIssueKey(issue);
    const remaining = hydratedCountByKey.get(key) ?? 0;
    if (remaining > 0) {
      matched.push(issue);
      hydratedCountByKey.set(key, remaining - 1);
    } else {
      sourceOnly.push(issue);
    }
  }

  // Whatever's left in hydratedCountByKey is hydrated-only. Walk the
  // hydratedIssues array in order so we keep the original positions
  // for any caller that wants to display them.
  const hydratedConsumedByKey = new Map<string, number>();
  // Reconstruct how many we've taken per key (matched count) so we
  // skip exactly that many from the hydrated array.
  for (const issue of matched) {
    const key = normalizeIssueKey(issue);
    hydratedConsumedByKey.set(key, (hydratedConsumedByKey.get(key) ?? 0) + 1);
  }
  const hydratedOnly: ZodIssue[] = [];
  const hydratedSeenByKey = new Map<string, number>();
  for (const issue of hydratedIssues) {
    const key = normalizeIssueKey(issue);
    const seen = hydratedSeenByKey.get(key) ?? 0;
    const consumed = hydratedConsumedByKey.get(key) ?? 0;
    if (seen < consumed) {
      hydratedSeenByKey.set(key, seen + 1);
      continue;
    }
    hydratedOnly.push(issue);
    hydratedSeenByKey.set(key, seen + 1);
  }

  return { matched, sourceOnly, hydratedOnly };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
