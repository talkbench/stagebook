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
 * Scope: `treatments[].gameStages` + `treatments[].exitSequence` (checked
 * against the TREATMENT's locale) and `introSequences[].introSteps` (checked
 * against the INTRO SEQUENCE's own locale — intro runs before treatment
 * assignment, so it can't inherit a treatment).
 *
 * Comparison is by BCP-47 primary subtag (`he-IL` ≡ `he`) — the same unit the
 * chrome catalog resolves on, so a region-tagged treatment doesn't spuriously
 * mismatch a base-tagged prompt.
 */

/** What declares the locale a prompt is checked against — a treatment (for
 *  game/exit stages) or an intro sequence (for intro steps, which run before
 *  any treatment is assigned and so carry their own locale). */
export type LocaleContainerKind =
  | "treatment"
  | "intro sequence"
  | "consent arm";

export interface PromptLocaleMismatch {
  /** Kind of declaring container. */
  containerKind: LocaleContainerKind;
  /** Name of the declaring treatment / intro sequence. */
  containerName: string;
  /** Effective container locale (primary subtag, defaulted to `en`). */
  containerLocale: string;
  /** The `file:` path exactly as it appears in the hydrated file. */
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
  containerKind: LocaleContainerKind;
  containerName: string;
  containerLocale: string | undefined;
  file: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Collect prompt-file refs from a list of stages/steps under one container. */
function refsFromStageLists(
  container: Record<string, unknown>,
  stageLists: unknown[],
  containerKind: LocaleContainerKind,
  into: PromptRef[],
): void {
  const containerName =
    typeof container.name === "string" ? container.name : "(unnamed)";
  const containerLocale =
    typeof container.locale === "string" ? container.locale : undefined;
  for (const stages of stageLists) {
    if (!Array.isArray(stages)) continue;
    for (const stage of stages) {
      if (!isRecord(stage)) continue;
      const elements = stage.elements;
      if (!Array.isArray(elements)) continue;
      for (const el of elements) {
        if (!isRecord(el)) continue;
        if (el.type !== "prompt") continue;
        if (typeof el.file !== "string") continue;
        into.push({
          containerKind,
          containerName,
          containerLocale,
          file: el.file,
        });
      }
    }
  }
}

/** Defensive structural walk — input is a js-yaml parse of the hydrated
 *  treatment file, which may carry diagnostics elsewhere; never throw.
 *
 *  Game + exit stages are checked against their TREATMENT's locale; intro
 *  steps against their INTRO SEQUENCE's locale (intro runs pre-assignment, so
 *  it can't inherit a treatment). */
function walkPromptRefs(fileObj: unknown): PromptRef[] {
  const refs: PromptRef[] = [];
  if (!isRecord(fileObj)) return refs;

  const treatments = fileObj.treatments;
  if (Array.isArray(treatments)) {
    for (const t of treatments) {
      if (!isRecord(t)) continue;
      refsFromStageLists(t, [t.gameStages, t.exitSequence], "treatment", refs);
    }
  }

  const introSequences = fileObj.introSequences;
  if (Array.isArray(introSequences)) {
    for (const seq of introSequences) {
      if (!isRecord(seq)) continue;
      refsFromStageLists(seq, [seq.introSteps], "intro sequence", refs);
    }
  }

  // Consent arms (#481) declare their own locale (consent runs before
  // treatment assignment, like intro sequences).
  const consent = fileObj.consent;
  if (Array.isArray(consent)) {
    for (const arm of consent) {
      if (!isRecord(arm)) continue;
      refsFromStageLists(arm, [arm.steps], "consent arm", refs);
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
  // One report per (container, file) pair: the same prompt referenced from
  // several stages of one container is a single problem, not several.
  const reported = new Set<string>();
  for (const ref of walkPromptRefs(fileObj)) {
    if (!promptLocales.has(ref.file)) continue;
    // A leaked `${...}` placeholder in the container's locale is a different
    // problem with its own schema diagnostic — comparing against it would
    // just produce a confusing second message. Skip; the leak is reported.
    if (ref.containerLocale?.includes("${")) continue;
    const containerLocale = primarySubtag(ref.containerLocale);
    const promptLocale = primarySubtag(promptLocales.get(ref.file));
    if (containerLocale === promptLocale) continue;
    const key = `${ref.containerKind} ${ref.containerName} ${ref.file}`;
    if (reported.has(key)) continue;
    reported.add(key);
    mismatches.push({
      containerKind: ref.containerKind,
      containerName: ref.containerName,
      containerLocale,
      promptFile: ref.file,
      promptLocale,
      message:
        `Prompt "${ref.file}" is authored in locale "${promptLocale}" but ` +
        `${ref.containerKind} "${ref.containerName}" declares locale "${containerLocale}". ` +
        `Translate the prompt (and tag it with \`locale: ${containerLocale}\` ` +
        `in its frontmatter), or point the ${ref.containerKind} at the right ` +
        `per-locale file. A prompt with no frontmatter \`locale\` counts as "en".`,
    });
  }
  return mismatches;
}

/**
 * One treatment locale for which the study declares NO matching consent arm.
 * The cross-collection (treatments × consent arms) counterpart to the
 * per-prompt locale-consistency rule above.
 */
export interface ConsentLocaleGap {
  /** Effective treatment locale (primary subtag, defaulted to `en`) that no
   *  consent arm covers. */
  locale: string;
  /** Names of the treatments declaring that locale, in first-seen order. */
  treatments: string[];
  message: string;
}

/**
 * i18n-completeness check (#529, ADR docs/decisions/2026-07-consent-debrief.md
 * "Phase 3"): warn when a treatment declares a `locale` for which the study has
 * no consent arm — a participant assigned that treatment would have no consent
 * content in their language.
 *
 * **Warning, not error, by design.** Consent has no treatment-level pairing
 * (ADR decision #4): a study may legitimately run a single-locale consent while
 * treatments span locales, or handle a locale's consent out-of-band. This is a
 * completeness nudge, not a hard constraint — the caller renders it at warning
 * severity.
 *
 * Semantics mirror `checkPromptLocaleConsistency`: locales compare by BCP-47
 * primary subtag (`he-IL` ≡ `he`), both consent-arm and treatment `locale`
 * default to `en` when absent, and a leaked `${…}` placeholder (in either) is
 * skipped — that leak is a different problem with its own schema diagnostic.
 *
 * **Opt-in.** A file with no consent arms (absent or empty) is not using the
 * feature, so nothing is flagged. Findings are deduplicated per locale: three
 * `he` treatments with no `he` arm produce one gap naming all three.
 *
 * Pure function over the hydrated (post-fillTemplates) treatment file — no I/O.
 * `consentArm` templates have already fanned out to concrete per-locale arms by
 * the time this runs, which is why it belongs with the post-hydration rules.
 */
export function checkConsentLocaleCoverage(
  fileObj: unknown,
): ConsentLocaleGap[] {
  if (!isRecord(fileObj)) return [];

  const consent = fileObj.consent;
  // Opt-in: no consent collection (absent or empty) means the feature isn't in
  // use, so there is nothing to be complete about.
  if (!Array.isArray(consent) || consent.length === 0) return [];

  // Locales the study's consent arms cover. A leaked `${…}` arm locale is
  // dropped (it covers nothing and is reported elsewhere).
  const coveredLocales = new Set<string>();
  for (const arm of consent) {
    if (!isRecord(arm)) continue;
    const raw = typeof arm.locale === "string" ? arm.locale : undefined;
    if (raw?.includes("${")) continue;
    coveredLocales.add(primarySubtag(raw));
  }

  const treatments = fileObj.treatments;
  if (!Array.isArray(treatments)) return [];

  // Uncovered locale → treatment names declaring it. Both the Map (keyed by
  // locale) and each name Set preserve first-seen order for stable output while
  // deduplicating in O(1) — the Set-based dedup `checkPromptLocaleConsistency`
  // uses for its per-(container, file) reports.
  const gaps = new Map<string, Set<string>>();
  for (const t of treatments) {
    if (!isRecord(t)) continue;
    const raw = typeof t.locale === "string" ? t.locale : undefined;
    // A leaked `${…}` placeholder in the treatment locale is a different
    // problem with its own schema diagnostic — skip rather than double-report.
    if (raw?.includes("${")) continue;
    const locale = primarySubtag(raw);
    if (coveredLocales.has(locale)) continue;
    const name = typeof t.name === "string" ? t.name : "(unnamed)";
    const names = gaps.get(locale);
    if (names === undefined) {
      gaps.set(locale, new Set([name]));
    } else {
      names.add(name);
    }
  }

  return [...gaps].map(([locale, nameSet]) => {
    const names = [...nameSet];
    const nameList = names.map((n) => `"${n}"`).join(", ");
    const clause =
      names.length > 1
        ? `Treatments ${nameList} declare`
        : `Treatment ${nameList} declares`;
    return {
      locale,
      treatments: names,
      message:
        `${clause} locale "${locale}", but no consent arm is authored in ` +
        `that locale. Add a consent arm with \`locale: ${locale}\` so ` +
        `participants assigned this treatment see consent in their language, ` +
        `or run a single-locale consent deliberately — consent is not paired ` +
        `to treatments, so this is a warning, not an error. A consent arm ` +
        `with no \`locale\` counts as "en".`,
    };
  });
}
