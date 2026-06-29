import { z, ZodIssue } from "zod";
import { load as loadYaml } from "js-yaml";
import { nameSchema, localeSchema } from "./primitives.js";

// ---------------------------------------------------------------------------
// Prompt file format (#243)
// ---------------------------------------------------------------------------
//
// A prompt file is a `*.prompt.md` markdown document with two or three
// sections separated by `---` lines:
//
//   ---
//   <YAML frontmatter — `type:` discriminates the response shape>
//   ---
//   <markdown body — the participant-facing question>
//   ---                       <-- third section omitted for `noResponse`
//   <response items — `-` lines for list types, `>` lines for openResponse>
//
// Per-type frontmatter is `.strict()` — unknown keys (`tytle:`,
// `placholder:`, `interavl:`, …) fail at preflight. Per-type marker
// enforcement in the body section catches `>` lines on a multipleChoice
// or `-` lines on an openResponse.
//
// `***` and `___` are the body's horizontal-rule alternatives (since
// `---` is the section delimiter).

// --- Per-type metadata schemas ---

const baseMetadataFields = {
  // `name` is kept (Principle 9 — name is the universal identifier
  // across all study portions, addressable or not). Optional.
  //
  // Validated against `nameSchema` (64-char cap, alphanumeric + space +
  // `_`/`-` + `${field}` templates) so a frontmatter `name: foo/bar`
  // or `name: <65 chars>` is rejected at parse time with a clear
  // message — instead of silently producing an invalid synthesized
  // storage key later in the render path (#360).
  name: nameSchema.optional(),
  notes: z.string().optional(),
  // The language this prompt file is authored in (BCP-47, e.g. `he`). Optional;
  // absent means English. Used by the post-hydration content rule to verify a
  // prompt's locale matches the treatment that renders it (so a `locale: he`
  // treatment can't ship an untranslated/mistagged English prompt). The tag is
  // not enforced against the shipped-catalog set here — it's a declaration of
  // what the file contains, checked against the treatment's locale downstream.
  locale: localeSchema.optional(),
};

const noResponseMetadataSchema = z
  .object({
    type: z.literal("noResponse"),
    ...baseMetadataFields,
  })
  .strict();

const openResponseMetadataSchema = z
  .object({
    type: z.literal("openResponse"),
    ...baseMetadataFields,
    rows: z.number().int().min(1).optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
  })
  .strict();

const multipleChoiceMetadataSchema = z
  .object({
    type: z.literal("multipleChoice"),
    ...baseMetadataFields,
    select: z.enum(["single", "multiple"]).optional().default("single"),
    layout: z.enum(["vertical", "horizontal"]).optional().default("vertical"),
    shuffle: z.boolean().optional(),
  })
  .strict();

// `dropdown` is a single-choice picker rendered as a `<select>` —
// same response shape as a `multipleChoice` with `select: single`,
// but compact UI for long option lists (countries, languages,
// many-step Likert) where rendering every option as a radio is noisy.
const dropdownMetadataSchema = z
  .object({
    type: z.literal("dropdown"),
    ...baseMetadataFields,
    placeholder: z.string().optional(),
    shuffle: z.boolean().optional(),
  })
  .strict();

const listSorterMetadataSchema = z
  .object({
    type: z.literal("listSorter"),
    ...baseMetadataFields,
    shuffle: z.boolean().optional(),
  })
  .strict();

const sliderMetadataSchema = z
  .object({
    type: z.literal("slider"),
    ...baseMetadataFields,
    min: z.number(),
    max: z.number(),
    interval: z.number().positive(),
    // When true, the slider renders a numeric value badge above the
    // thumb after the participant has selected a value. Off by
    // default to preserve the "no anchoring information" posture
    // (#326); opt in per prompt by setting `showValue: true` in the
    // frontmatter. Useful on Likert / 1-N scales where seeing the
    // selected number is a UX win and where the participant could
    // count tick marks anyway.
    showValue: z.boolean().optional(),
  })
  .strict();

/**
 * One per response type, each `.strict()` per #243. The discriminated
 * union's input `type:` selects exactly one branch — cross-field rules
 * (e.g. "rows can only appear on openResponse") fall out of the per-branch
 * field lists for free.
 *
 * Cross-field numeric rules (min<max, min+interval<=max, minLength<=maxLength)
 * live in the union's outer `.superRefine` rather than per-branch
 * `.refine()`. Reason: Zod 3's `discriminatedUnion` rejects `ZodEffects`
 * members, so any `.refine` applied to a branch breaks the union.
 */
export const promptMetadataSchema = z
  .discriminatedUnion("type", [
    noResponseMetadataSchema,
    openResponseMetadataSchema,
    multipleChoiceMetadataSchema,
    dropdownMetadataSchema,
    listSorterMetadataSchema,
    sliderMetadataSchema,
  ])
  .superRefine((data, ctx) => {
    if (data.type === "openResponse") {
      if (
        data.minLength !== undefined &&
        data.maxLength !== undefined &&
        data.minLength > data.maxLength
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "minLength cannot be greater than maxLength",
          path: ["minLength"],
        });
      }
    }
    if (data.type === "slider") {
      if (data.min >= data.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "min must be less than max",
          path: ["min"],
        });
      }
      if (data.min + data.interval > data.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "min + interval must be ≤ max",
          path: ["interval"],
        });
      }
    }
  });
export type MetadataType = z.infer<typeof promptMetadataSchema>;

// Back-compat aliases — the old `metadataTypeSchema` / `metadataRefineSchema`
// pair was the workaround for `z.object().superRefine()` skipping its
// refinement when object validation failed (pre-discriminatedUnion). Both
// roles are now served by `promptMetadataSchema` itself.
export const metadataTypeSchema = promptMetadataSchema;
export const metadataRefineSchema = promptMetadataSchema;
export const metadataLogicalSchema = promptMetadataSchema;
export type MetadataRefineType = MetadataType;

/**
 * Parse a numeric response line. Used by sliders (always numeric) and by
 * multipleChoice prompts in numeric mode (#282). One of:
 *   - `- 50` — bare number (no colon → label defaults to the number's
 *     string form)
 *   - `- 50: Somewhat familiar` — number + label
 *   - `- 50:` — number + explicit empty label. Only honored when
 *     `allowEmptyLabel` is true (sliders, #325). For multipleChoice
 *     numeric mode we fall back to the number string instead, because
 *     an unlabeled radio is bad UX (empty visible text + empty
 *     accessible name).
 * The first colon separates point from label, so labels can themselves
 * contain colons.
 */
function parseNumericResponseLine(
  raw: string,
  options: { allowEmptyLabel?: boolean } = {},
): { ok: true; point: number; label: string } | { ok: false; message: string } {
  // Caller has already stripped the `- ` prefix and `\n`.
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      message:
        "Numeric response line is empty (expected `- <number>(: <label>)?`).",
    };
  }
  const colonIdx = trimmed.indexOf(":");
  let pointStr: string;
  let label: string | null;
  if (colonIdx < 0) {
    // No colon — fall through to the pointStr fallback below.
    pointStr = trimmed;
    label = null;
  } else {
    pointStr = trimmed.slice(0, colonIdx).trim();
    const afterColon = trimmed.slice(colonIdx + 1).trim();
    if (options.allowEmptyLabel) {
      // Slider case (#325): preserve `""` so a researcher can put a tick
      // at this snap point with no label text. `"" ?? x` is `""`, so the
      // empty string survives the fallback below.
      label = afterColon;
    } else {
      // multipleChoice numeric mode (#282): collapse empty-after-colon
      // back to null so the fallback produces the stringified number.
      // Legacy behavior preserved — unlabeled radios are bad UX.
      label = afterColon.length > 0 ? afterColon : null;
    }
  }
  if (pointStr.length === 0) {
    return {
      ok: false,
      message: `Numeric response line "${trimmed}" must start with a number, e.g. "- 0: Not familiar".`,
    };
  }
  const point = Number(pointStr);
  if (!Number.isFinite(point)) {
    return {
      ok: false,
      message: `Numeric response line "${trimmed}" must start with a number, e.g. "- 0: Not familiar". Got "${pointStr}".`,
    };
  }
  return { ok: true, point, label: label ?? pointStr };
}

/**
 * Inspect a response-line content (already stripped of `- ` prefix) to see
 * if it is an explicit numeric option: `<number>: <label>` with a finite
 * number before the first colon.
 *
 * The colon is the numeric-mode signal (#289). A bare `- 1` is NOT numeric —
 * it's shorthand for `- 1: 1` (text label "1"). This keeps comprehension
 * checks / quizzes whose labels happen to be small integers (`1 / 2 / 3 /
 * It Varies`) in text mode instead of false-positiving into a numeric scale.
 * To get numeric semantics (responsePoints) an author must opt in by labeling
 * every option `<number>: <label>` — used by multipleChoice mode detection:
 * if every option is an explicit numeric option, the prompt is numeric (#282).
 */
function isNumericResponseLine(raw: string): boolean {
  const trimmed = raw.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx < 0) return false;
  const pointStr = trimmed.slice(0, colonIdx).trim();
  if (pointStr.length === 0) return false;
  return Number.isFinite(Number(pointStr));
}

/**
 * Back-compat shim. The old runtime had a separate `validateSliderLabels`
 * that cross-checked `metadata.labelPts.length === responseItems.length`.
 * After #243 slider labels and points come from the same body lines, so
 * the cross-check is structurally impossible to fail and the helper is a
 * no-op. Kept exported because external tooling may still import it.
 */
export const validateSliderLabels = (
  _metadata: MetadataType,
  _responseItems: string[],
): ZodIssue[] => [];

// --- File-level parser ---

export interface ParsedPromptFile {
  metadata: MetadataType;
  body: string;
  /**
   * Response section items, one entry per non-empty body-section line.
   * Shape depends on `metadata.type`:
   *   - multipleChoice / listSorter — choice/item strings
   *   - openResponse — placeholder lines
   *   - slider — labels (one per parsed line; aligned with `responsePoints`)
   *   - multipleChoice (numeric mode, #282) — labels (aligned with `responsePoints`)
   *   - noResponse — empty array
   */
  responseItems: string[];
  /**
   * Numeric per-option values, parsed from the body section. Populated for:
   *   - slider — every line is numeric
   *   - multipleChoice in numeric mode (#282) — every option uses the
   *     explicit `- <number>: <label>` colon form (#289). A bare `- 1` is
   *     text, not a scale point, so it does NOT populate this array.
   * Empty for text-only multipleChoice, listSorter, openResponse, noResponse.
   * `responsePoints[i]` corresponds to `responseItems[i]`.
   */
  responsePoints: number[];
  /**
   * Deprecated: use `responsePoints`. Retained as an alias for sliders so
   * existing consumers continue to work; identical to `responsePoints` for
   * slider prompts. Will be removed in a future release.
   * @deprecated
   */
  sliderPoints: number[];
}

/**
 * Split a prompt-file string on top-level `---` section delimiters,
 * skipping any `---` lines that appear inside a fenced code block.
 *
 * The previous implementation was a single regex split — `trimmed.
 * split(/^-{3,}$/gm)` — which matched any line of three-or-more
 * hyphens anywhere in the file, including inside fenced code
 * (#380). A researcher quoting Stagebook's prompt-file syntax inside
 * a `noResponse` prompt would have their body silently shredded into
 * pseudo-sections and rejected with "must have exactly two sections."
 *
 * This walks line-by-line, tracking whether the cursor is inside a
 * fence opened by ```` ``` ```` (any info-string allowed). Only `---`
 * lines outside the fence count as section boundaries. Matches the
 * regex split's output shape: a file starting with `---` produces a
 * leading empty string section (sections[0]), the metadata YAML is
 * sections[1], the body is sections[2], and the optional response
 * string is sections[3].
 *
 * Edge cases not handled (deliberate, to keep the rule simple):
 * - Indented fences (CommonMark allows up to 3 spaces). Stagebook
 *   prompts don't author indented fences in practice.
 * - Tilde-fenced code (`~~~`). Same reasoning; backtick is the only
 *   form Stagebook prompts use.
 */
export function splitOnTopLevelHrules(input: string): string[] {
  // Mask any in-fence `^-{3,}$` lines so the legacy regex split can't
  // see them. The mask prepends a null byte ( ), which makes
  // `^-{3,}$` no longer match (the line no longer starts with `-`),
  // and won't collide with any byte in a real prompt file. After the
  // split, strip the null bytes back out to restore the original
  // line. This preserves the exact byte shape the regex split
  // produced pre-#380 — leading / trailing newlines around each
  // section stay where they were — so any future consumer that
  // depends on the legacy output shape isn't silently broken.
  const MASK = " ";
  const lines = input.split("\n");
  let insideFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      insideFence = !insideFence;
    } else if (insideFence && /^-{3,}$/.test(line)) {
      lines[i] = MASK + line;
    }
  }
  const sections = lines.join("\n").split(/^-{3,}$/gm);
  return sections.map((s) => s.replaceAll(MASK, ""));
}

export const promptFileSchema: z.ZodType<
  ParsedPromptFile,
  z.ZodTypeDef,
  string
> = z
  .string()
  .min(1, "Prompt file string is empty")
  .transform((str, ctx): ParsedPromptFile | typeof z.NEVER => {
    const trimmed = str.trim();
    if (trimmed.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt file string is empty",
      });
      return z.NEVER;
    }

    const sections = splitOnTopLevelHrules(trimmed);

    // First section is the empty string before the leading `---`.
    if (sections.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Prompt file must have a `---`-delimited frontmatter and body. Use `***` or `___` for horizontal rules in the body, since `---` delimits sections.",
      });
      return z.NEVER;
    }

    const metadataYaml = sections[1];
    const body = sections[2];
    // For `noResponse` files this stays undefined; everyone else expects
    // exactly one response section. We validate the section count below
    // once we know the type.
    const responseString = sections[3];

    let metadata: unknown;
    try {
      metadata = loadYaml(metadataYaml);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed to parse metadata YAML",
        path: ["metadata"],
      });
      return z.NEVER;
    }

    const metaResult = promptMetadataSchema.safeParse(metadata);
    if (!metaResult.success) {
      metaResult.error.issues.forEach((issue) =>
        ctx.addIssue({
          ...issue,
          path: ["metadata", ...issue.path],
        }),
      );
      return z.NEVER;
    }
    const parsedMetadata = metaResult.data;

    if (!body || body.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt body section is empty",
        path: ["body"],
      });
    }

    // Section-count rules per #243:
    //   noResponse — exactly two sections (frontmatter + body).
    //   everyone else — exactly three (frontmatter + body + responses).
    if (parsedMetadata.type === "noResponse") {
      if (sections.length > 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["responses"],
          message:
            "noResponse prompt must have exactly two sections (frontmatter + body). Drop the trailing `---` and any third section.",
        });
      }
      return {
        metadata: parsedMetadata,
        body: body?.trim() ?? "",
        responseItems: [],
        responsePoints: [],
        sliderPoints: [],
      };
    }

    if (sections.length < 4 || responseString === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["responses"],
        message: `${parsedMetadata.type} prompt must have a third section listing the responses.`,
      });
      return z.NEVER;
    }
    // Exact section count enforcement: extra `---` after the response
    // section (e.g. a stray trailing delimiter, or a `---` used as a
    // horizontal rule inside the response section) silently splits a
    // valid file into pieces we'd otherwise drop. Reject so the author
    // gets the same `***`/`___` migration hint as the section-count
    // collisions inside the body section.
    if (sections.length > 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["responses"],
        message: `${parsedMetadata.type} prompt must have exactly three sections (frontmatter + body + responses). Use \`***\` or \`___\` for horizontal rules in the body, since \`---\` delimits sections.`,
      });
    }

    const responseLines = responseString
      // Match the structural section split (`/^-{3,}$/gm`) by also
      // accepting `\r`-only line endings — legacy Mac files and some
      // Windows tooling normalise line breaks differently.
      .split(/\r?\n|\r/g)
      .filter((line) => line.trim().length > 0);

    // Per-type marker enforcement (#243). Both forms require a trailing
    // space (or the bare marker on its own line) — `>X` / `-X` no-space
    // forms are rejected so the substring(2) extraction always lands on
    // the actual content.
    const expectedMarker = parsedMetadata.type === "openResponse" ? ">" : "-";
    for (const line of responseLines) {
      const isDash = line.startsWith("- ") || line === "-";
      const isAngle = line.startsWith("> ") || line === ">";
      if (expectedMarker === ">" && !isAngle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["responses"],
          message: `openResponse placeholder lines must start with "> ". Got: "${line}"`,
        });
      }
      if (expectedMarker === "-" && !isDash) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["responses"],
          message: `${parsedMetadata.type} response lines must start with "- ". Got: "${line}"`,
        });
      }
    }

    let responseItems: string[] = [];
    let responsePoints: number[] = [];
    if (parsedMetadata.type === "slider") {
      const points: number[] = [];
      const labels: string[] = [];
      for (const line of responseLines) {
        if (!(line.startsWith("- ") || line === "-")) continue;
        const stripped = line === "-" ? "" : line.substring(2);
        // Slider: `- N:` is a deliberate empty label (tick with no
        // visible text). multipleChoice keeps the legacy fallback (#325).
        const parsed = parseNumericResponseLine(stripped, {
          allowEmptyLabel: true,
        });
        if (!parsed.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["responses"],
            message: parsed.message,
          });
          continue;
        }
        points.push(parsed.point);
        labels.push(parsed.label);
      }
      responsePoints = points;
      responseItems = labels;
    } else if (parsedMetadata.type === "multipleChoice") {
      // #282/#289: multipleChoice options are all-numeric or all-text. The
      // explicit `<number>: <label>` colon form is the numeric signal — a
      // bare `- 1` is text (label "1"), so `1 / 2 / 3 / It Varies`
      // comprehension checks stay text instead of erroring. All explicit
      // numeric → numeric mode; mixing explicit-numeric with anything else =
      // validation error. Numeric mode is restricted to single-select (radio);
      // multi-select numeric mode has no clean averaging semantics and is out
      // of scope for v1.
      const stripped: string[] = [];
      for (const line of responseLines) {
        if (!(line.startsWith("- ") || line === "-")) continue;
        stripped.push(line === "-" ? "" : line.substring(2));
      }
      const numericFlags = stripped.map((s) => isNumericResponseLine(s));
      const allNumeric = stripped.length > 0 && numericFlags.every((f) => f);
      const anyNumeric = numericFlags.some((f) => f);
      if (anyNumeric && !allNumeric) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["responses"],
          message:
            "multipleChoice prompt mixes numeric and text response options. Either give every option a `<number>: <label>` prefix or remove all numeric prefixes.",
        });
      }
      if (allNumeric) {
        if (parsedMetadata.select === "multiple") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["responses"],
            message:
              "multipleChoice prompts in numeric mode (#282) must be single-select. Multi-select numeric mode is not supported in v1.",
          });
        }
        const points: number[] = [];
        const labels: string[] = [];
        for (const s of stripped) {
          const parsed = parseNumericResponseLine(s);
          if (!parsed.ok) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["responses"],
              message: parsed.message,
            });
            continue;
          }
          points.push(parsed.point);
          labels.push(parsed.label);
        }
        // Numeric values must be unique within the prompt.
        const seen = new Set<number>();
        for (const p of points) {
          if (seen.has(p)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["responses"],
              message: `multipleChoice prompt has duplicate numeric value ${p}. Each option must have a unique numeric value.`,
            });
            break;
          }
          seen.add(p);
        }
        responsePoints = points;
        responseItems = labels;
      } else {
        responseItems = stripped.map((s) => s.trim());
      }
    } else {
      responseItems = responseLines
        .filter(
          (line) =>
            line.startsWith("- ") ||
            line === "-" ||
            line.startsWith("> ") ||
            line === ">",
        )
        .map((line) =>
          line === "-" || line === ">" ? "" : line.substring(2).trim(),
        );
    }

    return {
      metadata: parsedMetadata,
      body: body?.trim() ?? "",
      responseItems,
      responsePoints,
      // Back-compat alias: identical to `responsePoints` for sliders;
      // empty for everything else (matches pre-#282 behavior).
      sliderPoints: parsedMetadata.type === "slider" ? responsePoints : [],
    };
  });

export type PromptFileType = z.infer<typeof promptFileSchema>;
