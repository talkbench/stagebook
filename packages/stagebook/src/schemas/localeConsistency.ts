/**
 * Post-hydration locale-consistency rule (ADR
 * docs/decisions/2026-06-localization.md, decision #6):
 *
 *   Every prompt rendered by a treatment must be authored in that
 *   treatment's language — the prompt frontmatter `locale` must equal the
 *   treatment's `locale`, with BOTH defaulting to `en` when absent.
 *
 * The default makes the rule self-enforcing exactly where rigor is needed: a
 * `locale: he` treatment cannot reference an untagged prompt (absent → `en` →
 * mismatch → caught), while all-English studies stay frictionless (absent ==
 * absent == `en`).
 *
 * Pure functions over already-loaded data — the host (CLI, extension, viewer)
 * owns file I/O and supplies each referenced prompt's declared locale via a
 * map. Same division of labor as `resolveImports`. Prompts the host didn't
 * load (URLs, missing files) are skipped: missing-file and invalid-prompt
 * problems are different error classes with their own reporting.
 *
 * Scope: `treatments[].gameStages` and `treatments[].exitSequence`.
 * `introSequences` have no `locale` field (nothing to compare against) and are
 * deliberately out of scope until they grow one.
 *
 * Comparison is by BCP-47 primary subtag (`he-IL` ≡ `he`) — the same unit the
 * chrome catalog resolves on, so a region-tagged treatment doesn't spuriously
 * mismatch a base-tagged prompt.
 */

export interface PromptLocaleMismatch {
  treatmentName: string;
  /** Effective treatment locale (primary subtag, defaulted to `en`). */
  treatmentLocale: string;
  /** The `file:` path exactly as it appears in the hydrated treatment. */
  promptFile: string;
  /** Effective prompt locale (primary subtag, defaulted to `en`). */
  promptLocale: string;
  message: string;
}

function primarySubtag(locale: string | undefined): string {
  const tag = (locale ?? "").toLowerCase().split("-")[0] ?? "";
  return tag === "" ? "en" : tag;
}

function hasScheme(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path);
}

interface PromptRef {
  treatmentName: string;
  treatmentLocale: string | undefined;
  file: string;
}

/** Defensive structural walk — input is a js-yaml parse of the hydrated
 *  treatment file, which may carry diagnostics elsewhere; never throw. */
function walkPromptRefs(fileObj: unknown): PromptRef[] {
  const refs: PromptRef[] = [];
  if (typeof fileObj !== "object" || fileObj === null) return refs;
  const treatments = (fileObj as Record<string, unknown>).treatments;
  if (!Array.isArray(treatments)) return refs;

  for (const t of treatments) {
    if (typeof t !== "object" || t === null) continue;
    const treatment = t as Record<string, unknown>;
    const treatmentName =
      typeof treatment.name === "string" ? treatment.name : "(unnamed)";
    const treatmentLocale =
      typeof treatment.locale === "string" ? treatment.locale : undefined;

    const stageLists = [treatment.gameStages, treatment.exitSequence];
    for (const stages of stageLists) {
      if (!Array.isArray(stages)) continue;
      for (const stage of stages) {
        if (typeof stage !== "object" || stage === null) continue;
        const elements = (stage as Record<string, unknown>).elements;
        if (!Array.isArray(elements)) continue;
        for (const el of elements) {
          if (typeof el !== "object" || el === null) continue;
          const element = el as Record<string, unknown>;
          if (element.type !== "prompt") continue;
          if (typeof element.file !== "string") continue;
          refs.push({ treatmentName, treatmentLocale, file: element.file });
        }
      }
    }
  }
  return refs;
}

/**
 * Unique relative prompt-file paths referenced by the file's treatments —
 * the set a host should load (and parse for frontmatter `locale`) before
 * calling `checkPromptLocaleConsistency`. Scheme-bearing paths (http(s)://,
 * asset://) are excluded; the host can't meaningfully read those locally.
 */
export function collectReferencedPromptFiles(fileObj: unknown): string[] {
  const seen = new Set<string>();
  for (const ref of walkPromptRefs(fileObj)) {
    if (!hasScheme(ref.file)) seen.add(ref.file);
  }
  return [...seen];
}

/**
 * Run the locale-consistency rule.
 *
 * @param fileObj hydrated (post-fillTemplates) treatment file object
 * @param promptLocales map from `file:` path (exactly as written in the
 *   treatment) to that prompt's declared frontmatter `locale` — `undefined`
 *   for a loaded prompt that declares none. Paths absent from the map are
 *   skipped entirely.
 */
export function checkPromptLocaleConsistency(
  fileObj: unknown,
  promptLocales: ReadonlyMap<string, string | undefined>,
): PromptLocaleMismatch[] {
  const mismatches: PromptLocaleMismatch[] = [];
  for (const ref of walkPromptRefs(fileObj)) {
    if (!promptLocales.has(ref.file)) continue;
    const treatmentLocale = primarySubtag(ref.treatmentLocale);
    const promptLocale = primarySubtag(promptLocales.get(ref.file));
    if (treatmentLocale === promptLocale) continue;
    mismatches.push({
      treatmentName: ref.treatmentName,
      treatmentLocale,
      promptFile: ref.file,
      promptLocale,
      message:
        `Prompt "${ref.file}" is authored in locale "${promptLocale}" but ` +
        `treatment "${ref.treatmentName}" declares locale "${treatmentLocale}". ` +
        `Translate the prompt (and tag it with \`locale: ${treatmentLocale}\` ` +
        `in its frontmatter), or point the treatment at the right per-locale file. ` +
        `A prompt with no frontmatter \`locale\` counts as "en".`,
    });
  }
  return mismatches;
}
