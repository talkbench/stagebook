/**
 * Missing-alt-text lint for `image` elements (#536).
 *
 * `ImageElement` renders `<img alt={…}>`. When an author supplies no
 * `altText:`, the runtime falls back to `alt=""`, which is *technically valid*
 * — it marks the image decorative and hides it from screen readers. That's the
 * right call for a genuine divider or flourish, but wrong for an image that
 * carries information (a chart, a diagram, a stimulus). Because `alt=""` is
 * valid HTML, automated a11y tooling (axe) can't tell the two apart, so the
 * authoring layer has to nudge instead: warn when `altText` is *absent* and let
 * the author either describe the image or opt into decorative with an explicit
 * empty string.
 *
 * This is a lint (warning), never a hard error: some images really are
 * decorative, and `altText: ""` is the correct, un-warned way to say so. The
 * warning fires ONLY when the `altText` key is missing entirely — never when it
 * is present-but-empty.
 *
 * Precedent: this mirrors video's authorable captions (`captionsFile` on
 * `mediaPlayer`) — authoring-helped accessibility rather than a runtime
 * guarantee. See ADR docs/decisions/2026-07-accessibility.md (Decision 3).
 *
 * This runs as a SEPARATE post-validation check (like the consent
 * i18n-completeness warning, #529), NOT inside the `treatmentFileSchema`
 * superRefine. That's deliberate: a superRefine issue — even a self-marked
 * "warning" — makes `safeParse` return `success: false`, which non-diagnostic
 * consumers (VS Code preview via `parseTreatmentSource`, the viewer example
 * catalog, external manager/runner/annotator) read as a hard schema failure and
 * use to BLOCK a common, harmless input. Keeping it out of the schema preserves
 * the success/failure contract as "errors only."
 *
 * Wiring — two diagnostic surfaces, both of which return diagnostics (never a
 * pass/fail boolean), so `warning` severity flows through without blocking:
 *   - `validateTreatmentSource` appends it after the schema pass. That's the
 *     shared chokepoint for the CLI (raw source AND the expanded YAML, via
 *     `expandAndValidate`) and the VS Code expanded preview — one wiring point
 *     covers all of them, positioned via the same mapper.
 *   - `validateTreatmentDiff` runs it over the un-expanded source object for the
 *     inline editor squiggle (that path doesn't go through
 *     `validateTreatmentSource`).
 *
 * The walk mirrors `collectStorageKeyCollisions`: every element-bearing
 * container a participant can traverse (treatment game stages + exit
 * sequences, intro-sequence steps, consent-arm steps). Like that walker it
 * deliberately does NOT scan `templates:` bodies — only the concrete
 * containers above. An image authored inside a template body is still linted
 * once it lands in a real stage: `validateTreatmentSource` runs over the
 * *expanded* tree in the CLI / expanded-preview paths, where the invocation has
 * become a concrete element. The inline editor diff runs over the un-expanded
 * source, so a template-provided image surfaces in the expanded preview rather
 * than on the invocation line — the same treatment every post-hydration rule
 * gets. Scanning raw template bodies would instead mis-position warnings at
 * `${placeholder}`-bearing partial elements.
 */

export interface MissingImageAltText {
  /** Path to the offending image element within the treatment file. */
  path: (string | number)[];
  /** Human-readable warning. */
  message: string;
}

type Path = (string | number)[];

const MESSAGE =
  "Image element has no `altText`. Add `altText:` describing the image for " +
  'screen-reader users, or set `altText: ""` to mark it decorative.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scanElements(
  elements: unknown,
  basePath: Path,
  into: MissingImageAltText[],
): void {
  if (!Array.isArray(elements)) return;
  elements.forEach((el, idx) => {
    if (!isRecord(el) || el.type !== "image") return;
    // Warn ONLY when the key is absent. An explicit `altText: ""` is the
    // decorative escape hatch and must never warn; a present-but-non-string
    // value (e.g. `altText: null`) is a *schema* error reported elsewhere, so
    // we don't double-report it here.
    if ("altText" in el) return;
    into.push({
      path: [...basePath, idx],
      message: MESSAGE,
    });
  });
}

function scanStageList(
  stages: unknown,
  basePath: Path,
  into: MissingImageAltText[],
): void {
  if (!Array.isArray(stages)) return;
  stages.forEach((stage, stageIdx) => {
    if (!isRecord(stage)) return;
    scanElements(stage.elements, [...basePath, stageIdx, "elements"], into);
  });
}

/**
 * Collect every `image` element that is missing an `altText` field, across all
 * element-bearing containers in the treatment file. Defensive against
 * malformed input (returns `[]`): the schema runs this on dirty parses.
 */
export function collectMissingImageAltText(
  data: unknown,
): MissingImageAltText[] {
  if (!isRecord(data)) return [];
  const out: MissingImageAltText[] = [];

  if (Array.isArray(data.treatments)) {
    data.treatments.forEach((treatment, tIdx) => {
      if (!isRecord(treatment)) return;
      scanStageList(
        treatment.gameStages,
        ["treatments", tIdx, "gameStages"],
        out,
      );
      scanStageList(
        treatment.exitSequence,
        ["treatments", tIdx, "exitSequence"],
        out,
      );
    });
  }

  if (Array.isArray(data.introSequences)) {
    data.introSequences.forEach((seq, seqIdx) => {
      if (!isRecord(seq)) return;
      scanStageList(
        seq.introSteps,
        ["introSequences", seqIdx, "introSteps"],
        out,
      );
    });
  }

  if (Array.isArray(data.consent)) {
    data.consent.forEach((arm, armIdx) => {
      if (!isRecord(arm)) return;
      scanStageList(arm.steps, ["consent", armIdx, "steps"], out);
    });
  }

  return out;
}
