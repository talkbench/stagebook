/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { z } from "zod";
import { collectStorageKeyCollisions } from "./storageKeyCollisions.js";
import { validateTreatmentFileReferences } from "./validateReferences.js";
import { nameSchema, localeSchema, type NameType } from "./primitives.js";
import {
  namedSourceEnum,
  externalSourceEnum,
  referenceSchema,
  parseDottedReference,
  positionSelectorSchema,
  type ReferenceType,
  type NamedReferenceType,
  type ExternalReferenceType,
  type NamedSource,
  type ExternalSource,
  type PositionSelectorType,
} from "./reference.js";

// Re-exports so consumers' existing imports from `./treatment.js` keep
// working after the reference machinery moved to its own module (#240).
export { nameSchema, localeSchema, type NameType };
export {
  namedSourceEnum,
  externalSourceEnum,
  referenceSchema,
  positionSelectorSchema,
  type ReferenceType,
  type NamedReferenceType,
  type ExternalReferenceType,
  type NamedSource,
  type ExternalSource,
  type PositionSelectorType,
};
export { parseDottedReference, formatReference } from "./reference.js";

// TODO: used by regex validation in conditionMatchesSchema — wire up or remove
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    if (e instanceof SyntaxError) {
      return false;
    }
    throw e;
  }
}

// ------------------ Names and files ------------------ //

// Field placeholder pattern: only alphanumeric + underscore.
// Must match FIELD_PLACEHOLDER_REGEX in templates/fillTemplates.ts
const FIELD_PLACEHOLDER_PATTERN = /\$\{[a-zA-Z0-9_]+\}/;

const fieldPlaceholderSchema = z.string().regex(FIELD_PLACEHOLDER_PATTERN, {
  message:
    "Field placeholder must be in the format `${fieldKey}` (alphanumeric and underscores only)",
});

/**
 * True if `value` contains any `${field}` placeholder. Used by cross-field
 * refinements that should skip validation until templates are filled.
 * Keeps placeholder detection colocated with `fieldPlaceholderSchema` so
 * future rule changes apply consistently.
 */
function containsFieldPlaceholder(value: string): boolean {
  return FIELD_PLACEHOLDER_PATTERN.test(value);
}

// `nameSchema` is defined in `./primitives.js` and re-exported above.

// `https?://path` — accepted by both browserUrlSchema and fileSchema.
// `asset://path` — accepted only by fileSchema (resolved via host's
//   `getAssetURL()`, see #188). Browser-direct fields don't accept
//   `asset://` because the browser can't navigate to it directly.
// Bare `scheme:foo` (no `//`) is always rejected — `new URL()` accepts
// opaque-scheme variants but downstream code expects a real
// hierarchical URL.
const HIERARCHICAL_HTTPS_RE = /^https?:\/\//i;
const HIERARCHICAL_ASSET_RE = /^asset:\/\//i;

/**
 * `browserUrlSchema` — strict `https?://` (with non-empty host) only.
 * Used for fields the browser fetches/navigates to directly: the
 * `qualtrics.url` iframe src, the `trackedLink.url` click-through. Drops
 * `asset://` because neither a browser navigation nor an iframe `src`
 * can resolve `asset://` (the host's resolver is platform-side,
 * unreachable from the browser-direct path).
 */
export const browserUrlSchema = z.string().refine(
  (url) => {
    if (!HIERARCHICAL_HTTPS_RE.test(url)) return false;
    try {
      const parsed = new URL(url);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.host.length > 0
      );
    } catch {
      return false;
    }
  },
  {
    message:
      "URL must use http:// or https:// with a non-empty host. (asset:// is not accepted on browser-direct URL fields — use it only on file: fields, where the host's getAssetURL() resolves it.)",
  },
);
export type BrowserUrlType = z.infer<typeof browserUrlSchema>;

/**
 * `fileSchema` — a resource handle the platform helps resolve to something
 * the browser can fetch. Three accepted forms:
 *
 *   1. **Relative path** (e.g. `prompts/foo.prompt.md`) — resolved
 *      against the treatment file's directory by the host loader.
 *   2. **`asset://…` URI** (e.g. `asset://clips/clip1.mp4`) — resolved
 *      by the host's `getAssetURL()` (#188).
 *   3. **`https?://…` URL** (e.g. `https://cdn.example.com/clip.mp4`) —
 *      passed straight through to the browser without resolution.
 *
 * Distinct from `browserUrlSchema` — that one is for URLs the browser
 * uses verbatim (trackedLink targets, qualtrics iframe src), where
 * `asset://` has no meaning. Used by every `file:` field in the schema.
 */
export const fileSchema = z
  .string()
  .min(1, "File path cannot be empty.")
  .refine(
    (value) => {
      // Defer all content-shape checks to post-fill when the path
      // contains a `${field}` placeholder (#398). The host (annotator,
      // deliberation-lab) binds the slot before the participant sees
      // the page; `resolvedTreatmentFileSchema` runs the strict checks
      // on the substituted value. A leak (placeholder still present
      // after fillTemplates) gets caught there with a clear message.
      if (containsFieldPlaceholder(value)) return true;
      // Reject scalars that are entirely whitespace.
      if (value.trim().length === 0) return false;
      // Reject opaque-scheme variants like `asset:clip.mp4` or
      // `https:cdn.example.com/x` (no `//`) — these parse via `new URL()`
      // but aren't what we mean.
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        if (HIERARCHICAL_HTTPS_RE.test(value)) {
          try {
            const parsed = new URL(value);
            return (
              (parsed.protocol === "http:" || parsed.protocol === "https:") &&
              parsed.host.length > 0
            );
          } catch {
            return false;
          }
        }
        if (HIERARCHICAL_ASSET_RE.test(value)) {
          try {
            const parsed = new URL(value);
            return parsed.host.length > 0 || parsed.pathname.length > 1;
          } catch {
            return false;
          }
        }
        // Some other opaque scheme (`ftp:`, `file:`, `mailto:`, …) —
        // not what `file:` fields accept.
        return false;
      }
      // No scheme — treat as a relative path. Reject absolute paths and
      // backslashes (Windows-style) since the host loader expects POSIX
      // relative paths.
      if (value.startsWith("/")) return false;
      if (value.includes("\\")) return false;
      return true;
    },
    {
      message:
        "File path must be a relative path (e.g. prompts/foo.prompt.md), an asset:// URI, or an http(s):// URL with a non-empty host.",
    },
  )
  .refine(
    (value) => {
      // Reject INTERIOR parent-directory traversal in relative paths. A `..`
      // segment after a real segment lets a `${field}`-substituted path (e.g.
      // `prompts/${locale}/…` filled with `../../x`) escape the treatment's
      // asset root — this also runs post-fill on the substituted value, so
      // that attack is rejected.
      //
      // A LEADING run of `..` segments is permitted: `resolveImports` rewrites
      // imported templates' `file:` paths relative to the main file, so
      // `imports: ../shared/x.stagebook.yaml` legitimately produces
      // `../shared/prompts/q.prompt.md` in the expanded treatment (a
      // documented, test-pinned layout — see resolveImportPath). Residual
      // caveat: a path that STARTS with a placeholder (`${x}/q.prompt.md`)
      // could be filled to a leading-`..` path and pass this gate; host
      // loaders remain responsible for sandboxing reads to the study root
      // (see StagebookContext.getTextContent contract).
      //
      // URLs (http(s)://, asset://) carry a scheme and are normalized by URL
      // parsing, so only scheme-less relative paths are constrained here.
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
      let seenRealSegment = false;
      for (const segment of value.split("/")) {
        if (segment === "..") {
          if (seenRealSegment) return false;
        } else {
          seenRealSegment = true;
        }
      }
      return true;
    },
    {
      message:
        "File path must not contain `..` segments after the start of the path (parent-directory traversal). A leading `../` prefix (e.g. shared templates imported from a parent directory) is allowed.",
    },
  );
export type FileType = z.infer<typeof fileSchema>;

/**
 * `promptFilePathSchema` — `fileSchema` plus the `.prompt.md` suffix
 * requirement. Applies only to `prompt.file:`.
 *
 * The extension check is deferred when the path contains a `${field}`
 * placeholder (#398). At pre-fill time we can't know what the bound
 * value will end in; `resolvedElementSchema` in `resolved.ts` enforces
 * `.prompt.md` (and rejects unresolved leaks) once the host has
 * substituted the slot.
 */
export const promptFilePathSchema = fileSchema.refine(
  (s) => containsFieldPlaceholder(s) || s.endsWith(".prompt.md"),
  {
    message:
      'Prompt files must use the .prompt.md extension (e.g., "myPrompt.prompt.md")',
  },
);

// stage duration:
export const durationSchema = z.number().int().positive(); // min: 1 second
export type DurationType = z.infer<typeof durationSchema>;

export const displayTimeSchema = z.number().int().nonnegative();
export type DisplayTimeType = z.infer<typeof displayTimeSchema>;

export const hideTimeSchema = z.number().int().positive();
export type HideTimeType = z.infer<typeof hideTimeSchema>;

export const positionSchema = z.number().int().nonnegative();
export type PositionType = z.infer<typeof positionSchema>;

// Position selector for *references* lives in `reference.ts` after #298 —
// re-exported via the schemas barrel. Reference-using sites no longer
// have a sibling `position:` field; the position is part of the reference
// itself (e.g. `0.prompt.recall.value`).

export const showToPositionsSchema = z
  .array(positionSchema, {
    required_error:
      "Expected an array for `showToPositions`. Make sure each item starts with a dash (`-`) in YAML.",
    invalid_type_error:
      "Expected an array for `showToPositions`. Make sure each item starts with a dash (`-`) in YAML.",
  })
  .nonempty(); // TODO: check for unique values (or coerce to unique values)
export type ShowToPositionsType = z.infer<typeof showToPositionsSchema>;

export const hideFromPositionsSchema = z
  .array(positionSchema, {
    required_error:
      "Expected an array for `hideFromPositions`. Make sure each item starts with a dash (`-`) in YAML.",
    invalid_type_error:
      "Expected an array for `hideFromPositions`. Make sure each item starts with a dash (`-`) in YAML.",
  })
  .nonempty(); // TODO: check for unique values (or coerce to unique values)
export type HideFromPositionsType = z.infer<typeof hideFromPositionsSchema>;

const displayRegionRangeSchema = z
  .object({
    first: z.number().int().nonnegative(),
    last: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.last < value.first) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`last` must be greater than or equal to `first`.",
      });
    }
  });

const displayRegionAxisSchema = z.union([
  z.number().int().nonnegative(),
  displayRegionRangeSchema,
]);

export const displayRegionSchema = z
  .object({
    rows: displayRegionAxisSchema,
    cols: displayRegionAxisSchema,
  })
  .strict();
export type DisplayRegionType = z.infer<typeof displayRegionSchema>;

const feedMediaSchema = z
  .object({
    audio: z.boolean().optional(),
    video: z.boolean().optional(),
    screen: z.boolean().optional(),
  })
  .strict();

const participantSourceSchema = z
  .object({
    type: z.literal("participant"),
    position: positionSchema,
  })
  .strict();

const selfSourceSchema = z
  .object({
    type: z.literal("self"),
  })
  .strict();

const otherSourceSchema = z
  .object({
    type: z
      .string()
      .min(1)
      .refine(
        (value) => value !== "participant" && value !== "self",
        "Provide additional data using a different source type.",
      ),
    position: z.union([positionSchema, z.string()]).optional(),
  })
  .strict();

const feedSourceSchema = z.union([
  participantSourceSchema,
  selfSourceSchema,
  otherSourceSchema,
]);

const renderHintSchema = z.union([
  z.literal("auto"),
  z.literal("tile"),
  z.literal("audioOnlyBadge"),
  z.literal("hidden"),
  z.string().min(1),
]);

const feedOptionsSchema = z.record(z.string(), z.unknown());

const layoutFeedSchema = z
  .object({
    source: feedSourceSchema,
    media: feedMediaSchema.optional(),
    displayRegion: displayRegionSchema,
    zOrder: z.number().int().optional(),
    render: renderHintSchema.optional(),
    label: z.string().optional(),
    options: feedOptionsSchema.optional(),
  })
  .strict();

const layoutFeedDefaultsSchema = z
  .object({
    media: feedMediaSchema.optional(),
    zOrder: z.number().int().optional(),
    render: renderHintSchema.optional(),
    label: z.string().optional(),
    options: feedOptionsSchema.optional(),
  })
  .strict();

const layoutGridOptionsSchema = z
  .object({
    gap: z.number().nonnegative().optional(),
    background: z.string().optional(),
  })
  .strict();

const layoutGridSchema = z
  .object({
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
    options: layoutGridOptionsSchema.optional(),
  })
  .strict();

const layoutDefinitionSchema = z
  .object({
    grid: layoutGridSchema,
    // `${field}` placeholder accepted (#284) — substituted with a literal
    // array at fillTemplates time. The grid-bounds superRefine below
    // skips iteration when feeds is a placeholder string.
    feeds: z.array(layoutFeedSchema).nonempty().or(fieldPlaceholderSchema),
    defaults: layoutFeedDefaultsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const gridRows = value.grid.rows;
    const gridCols = value.grid.cols;

    if (!Array.isArray(value.feeds)) return;
    value.feeds.forEach((feed, feedIndex) => {
      const rows =
        typeof feed.displayRegion.rows === "number"
          ? { first: feed.displayRegion.rows, last: feed.displayRegion.rows }
          : feed.displayRegion.rows;
      const cols =
        typeof feed.displayRegion.cols === "number"
          ? { first: feed.displayRegion.cols, last: feed.displayRegion.cols }
          : feed.displayRegion.cols;

      if (rows.first >= gridRows || rows.last >= gridRows) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["feeds", feedIndex, "displayRegion", "rows"],
          message: "`rows` indices must be within the grid bounds.",
        });
      }

      if (cols.first >= gridCols || cols.last >= gridCols) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["feeds", feedIndex, "displayRegion", "cols"],
          message: "`cols` indices must be within the grid bounds.",
        });
      }
    });
  });

const layoutBySeatSchema = z
  .record(z.string(), layoutDefinitionSchema)
  .superRefine((value, ctx) => {
    Object.keys(value).forEach((key) => {
      const seat = Number(key);
      if (!Number.isInteger(seat) || seat < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Layout keys must be zero-based nonnegative integers.",
        });
      }
    });
  });

const discussionRoomSchema = z
  .object({
    includePositions: z
      .array(positionSchema, {
        required_error:
          "Expected an array for `includePositions`. Make sure each item starts with a dash (`-`) in YAML.",
        invalid_type_error:
          "Expected an array for `includePositions`. Make sure each item starts with a dash (`-`) in YAML.",
      })
      .nonempty(),
  })
  .strict();

export const discussionSchema = z
  .object({
    chatType: z.enum(["text", "audio", "video"]),
    showNickname: z.boolean(),
    showTitle: z.boolean(),
    showSelfView: z.boolean().optional().default(true),
    showReportMissing: z.boolean().optional().default(true),
    showAudioMute: z.boolean().optional().default(true),
    showVideoMute: z.boolean().optional().default(true),
    reactionEmojisAvailable: z.array(z.string()).optional(),
    reactToSelf: z.boolean().optional(),
    numReactionsPerMessage: z.number().int().nonnegative().optional(),
    layout: layoutBySeatSchema.optional(),
    // `${field}` placeholder accepted (#284) — substituted with a literal
    // array at fillTemplates time. Resolved-shape validation in resolved.ts
    // catches placeholders that survive substitution.
    rooms: z
      .array(discussionRoomSchema)
      .nonempty()
      .or(fieldPlaceholderSchema)
      .optional(),
    // New: allow discussion-level position-based visibility controls
    showToPositions: showToPositionsSchema.optional(),
    hideFromPositions: hideFromPositionsSchema.optional(),
    conditions: z.lazy(() => conditionsSchema).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Emoji reaction parameters should only be used with text chat
    if (data.chatType !== "text") {
      if (data.reactionEmojisAvailable !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reactionEmojisAvailable"],
          message:
            "reactionEmojisAvailable can only be used with chatType 'text'",
        });
      }
      if (data.reactToSelf !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reactToSelf"],
          message: "reactToSelf can only be used with chatType 'text'",
        });
      }
      if (data.numReactionsPerMessage !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["numReactionsPerMessage"],
          message:
            "numReactionsPerMessage can only be used with chatType 'text'",
        });
      }
    }

    if (data.layout !== undefined && data.chatType !== "video") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layout"],
        message: "layout can only be used with chatType 'video'",
      });
    }

    if (data.rooms !== undefined && data.chatType !== "video") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rooms"],
        message: "rooms can only be used with chatType 'video'",
      });
    }
  });
export type DiscussionType = z.infer<typeof discussionSchema>;

// ------------------ Template contexts ------------------ //
const templateFieldKeysSchema = z
  .string()
  .regex(/^(?!d[0-9]+$)([a-zA-Z0-9_]+|\$\{[a-zA-Z0-9_]+\})$/, {
    message:
      "Field key must be alphanumeric with underscores only (no hyphens or spaces), or a placeholder `${fieldKey}`. Cannot conflict with reserved keys (d0, d1, etc.).",
  })
  .min(1)
  .superRefine((val, ctx) => {
    if (val == "type") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Field key cannot be 'type', as it is reserved for element types.",
      });
    }
  });

// `fields:` is a flat map of values — not a place for template
// invocations. A field value shaped like `{ template: "..." }` is
// always either (a) a hidden template-as-field-value indirection that
// works by accident (literal name) or (b) genuinely broken because
// the recursive fill hits a parameterized template name before any
// substitution can resolve it (#304). Reject either form at parse
// time and point authors to the cleaner alternative: pass the name
// as a string and put the invocation in the slot where it's used.
const fieldValueIsTemplateInvocation = (val: unknown): boolean =>
  val !== null &&
  typeof val === "object" &&
  !Array.isArray(val) &&
  "template" in val;

const templateFieldsSchema = z
  .record(templateFieldKeysSchema, z.any())
  .superRefine((fields, ctx) => {
    for (const [key, value] of Object.entries(fields)) {
      if (fieldValueIsTemplateInvocation(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message:
            `Template invocations are not allowed as \`fields:\` values. ` +
            `Move the invocation to the slot where it's used (e.g. a \`broadcast:\` dimension) ` +
            `and pass only the template name as a string field. ` +
            "For example, instead of `fields: { recallImages: { template: imageList } }` + `broadcast: { d0: ${recallImages} }`, " +
            "write `fields: { imageSet: imageList }` + `broadcast: { d0: { template: ${imageSet} } }`.",
        });
      }
    }
  });

const templateBroadcastAxisNameSchema = z.string().regex(/^d\d+$/, {
  message: "String must start with 'd' followed by a nonnegative integer",
});

export const templateBroadcastAxisValuesSchema: z.ZodType = z.lazy(() =>
  z
    .array(templateFieldsSchema)
    .nonempty()
    .or(templateContextSchema)
    .or(templateFieldKeysSchema),
);

export const templateContextSchema = z
  .object({
    template: nameSchema,
    fields: templateFieldsSchema.optional(),
    broadcast: z
      .record(
        templateBroadcastAxisNameSchema,
        templateBroadcastAxisValuesSchema,
      )
      .optional(),
  })
  .strict();
export type TemplateContextType = z.infer<typeof templateContextSchema>;

// helper function to extend a schema with template context, and
function altTemplateContext<T extends z.ZodTypeAny>(baseSchema: T) {
  return z.any().superRefine((data, ctx) => {
    if (data === undefined) {
      // throw new Error("data is undefined, this should not happen. This is a bug in the schema.");
      // console.log(
      //   "data is undefined, this should not happen. This is a bug in the schema."
      // );
      // return ctx.addIssue({
      //   code: z.ZodIssueCode.custom,
      //   message: "Data is undefined",
      // });
      return;
    }
    // Determine schema based on presence of `template` field

    const schemaToUse =
      data !== null && typeof data === "object" && "template" in data
        ? templateContextSchema
        : baseSchema;
    // console.log("data", data, "schemaToUse", 'template' in data ? "template" : "base");
    const result = schemaToUse.safeParse(data);

    if (!result.success) {
      result.error.issues.forEach((issue) =>
        ctx.addIssue({
          ...issue,
          path: [...issue.path],
        }),
      );
    }
  });
}

// References live in `./reference.js` (#240) and are re-exported above.

// --------------- Conditions --------------- //

const baseConditionSchema = z
  .object({
    // After #298 the position selector is part of the reference itself
    // (e.g. `0.prompt.X.value`, `self.entryUrl.params.condition`).
    // The pre-#298 sibling `position:` field is removed; the
    // game-stage rule that forbade `player`/`self` references at the
    // stage level reads the position from the parsed reference now.
    reference: referenceSchema,
  })
  .strict();

const conditionExistsSchema = baseConditionSchema
  .extend({
    comparator: z.literal("exists"),
    value: z.undefined(),
  })
  .strict();

const conditionDoesNotExistSchema = baseConditionSchema
  .extend({
    comparator: z.literal("doesNotExist"),
    value: z.undefined(),
  })
  .strict();

const conditionEqualsSchema = baseConditionSchema
  .extend({
    comparator: z.literal("equals"),
    value: z.string().or(z.number()).or(z.boolean()).or(fieldPlaceholderSchema),
  })
  .strict();

const conditionDoesNotEqualSchema = baseConditionSchema
  .extend({
    comparator: z.literal("doesNotEqual"),
    value: z.string().or(z.number()).or(z.boolean()).or(fieldPlaceholderSchema),
  })
  .strict();

const conditionIsAboveSchema = baseConditionSchema
  .extend({
    comparator: z.literal("isAbove"),
    value: z.number().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionIsBelowSchema = baseConditionSchema
  .extend({
    comparator: z.literal("isBelow"),
    value: z.number().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionIsAtLeastSchema = baseConditionSchema
  .extend({
    comparator: z.literal("isAtLeast"),
    value: z.number().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionIsAtMostSchema = baseConditionSchema
  .extend({
    comparator: z.literal("isAtMost"),
    value: z.number().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionHasLengthAtLeastSchema = baseConditionSchema
  .extend({
    comparator: z.literal("hasLengthAtLeast"),
    value: z.number().nonnegative().int().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionHasLengthAtMostSchema = baseConditionSchema
  .extend({
    comparator: z.literal("hasLengthAtMost"),
    value: z.number().nonnegative().int().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionIncludesSchema = baseConditionSchema
  .extend({
    comparator: z.literal("includes"),
    value: z.string().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionDoesNotIncludeSchema = baseConditionSchema
  .extend({
    comparator: z.literal("doesNotInclude"),
    value: z.string().or(fieldPlaceholderSchema),
  })
  .strict();

// todo: extend this to include regex validation
const conditionMatchesSchema = baseConditionSchema
  .extend({
    comparator: z.literal("matches"),
    value: z.string().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionDoesNotMatchSchema = baseConditionSchema
  .extend({
    comparator: z.literal("doesNotMatch"),
    value: z.string().or(fieldPlaceholderSchema),
  })
  .strict();

const conditionIsOneOfSchema = baseConditionSchema
  .extend({
    comparator: z.literal("isOneOf"),
    value: z
      .array(z.string().or(z.number()))
      .nonempty()
      .or(fieldPlaceholderSchema),
  })
  .strict();

const conditionIsNotOneOfSchema = baseConditionSchema
  .extend({
    comparator: z.literal("isNotOneOf"),
    value: z
      .array(z.string().or(z.number()))
      .nonempty()
      .or(fieldPlaceholderSchema),
  })
  .strict();

// Leaf form of a condition: an object with a `comparator` plus the
// reference/position/value triple. This is what the boolean tree's
// `all`/`any`/`none` operator branches eventually bottom out at.
const leafConditionSchema = z.discriminatedUnion("comparator", [
  conditionExistsSchema,
  conditionDoesNotExistSchema,
  conditionEqualsSchema,
  conditionDoesNotEqualSchema,
  conditionIsAboveSchema,
  conditionIsBelowSchema,
  conditionIsAtLeastSchema,
  conditionIsAtMostSchema,
  conditionHasLengthAtLeastSchema,
  conditionHasLengthAtMostSchema,
  conditionIncludesSchema,
  conditionDoesNotIncludeSchema,
  conditionMatchesSchema,
  conditionDoesNotMatchSchema,
  conditionIsOneOfSchema,
  conditionIsNotOneOfSchema,
]);

// Recursive boolean-tree node (#235). A condition is either:
//   - an `all: [...]`, `any: [...]`, or `none: [...]` operator node
//     whose children are themselves nodes (recurses), or
//   - a leaf (`comparator`-typed condition object).
// The operator branches are `.strict()` so combinations like
// `{all: [...], reference: ...}` fail loudly. `.nonempty()` rejects
// `all: []` etc. — vacuous truth on an empty operator is an
// author-error shape worth catching at preflight.
//
// `z.lazy` is required because the operator schemas reference
// `conditionNodeSchema` recursively; the outer `altTemplateContext`
// wrapper preserves `template:` invocation support at any tree level.
//
// `OPERATOR_KEYS` is the source-of-truth list of boolean-tree
// operator names, used by the typo-detection superRefine in
// `conditionsSchema` (below) and by the walker in
// `validateReferences.ts`. Defined in `conditionOperators.ts` to
// avoid an import cycle: `treatment.ts` imports
// `validateReferences.ts` for the cross-stage reference walker, so
// the shared list has to live in a third module both can import
// from. Re-exported here as part of the schemas package's public
// surface.
export { OPERATOR_KEYS, type OperatorKey } from "./conditionOperators.js";
import { OPERATOR_KEYS } from "./conditionOperators.js";

export const conditionNodeSchema: z.ZodType = z.lazy(() =>
  altTemplateContext(
    z.union([
      // `all`/`any`/`none` arrays accept a `${field}` placeholder (#284) —
      // substituted with a literal array at fillTemplates time. The
      // validateReferences walker already type-guards via `Array.isArray`
      // before iterating, so unsubstituted placeholders are skipped.
      z
        .object({
          all: z
            .array(conditionNodeSchema)
            .nonempty()
            .or(fieldPlaceholderSchema),
        })
        .strict(),
      z
        .object({
          any: z
            .array(conditionNodeSchema)
            .nonempty()
            .or(fieldPlaceholderSchema),
        })
        .strict(),
      z
        .object({
          none: z
            .array(conditionNodeSchema)
            .nonempty()
            .or(fieldPlaceholderSchema),
        })
        .strict(),
      leafConditionSchema,
    ]),
  ),
);

// Backward-compat alias: `conditionSchema` previously meant "a single
// condition object." It now means "any node in the boolean tree" (leaf
// or operator). Existing callers that expect a leaf still work for
// leaf inputs; new callers can pass operator nodes too.
export const conditionSchema = conditionNodeSchema;

// Positions that are forbidden on game-stage-level conditions because
// they would evaluate to a different result on each participant's client
// — causing one participant to skip a stage while the other renders it.
// Intro/exit steps are per-participant and have no such constraint.
//
// After #298 the position lives inside the reference itself, so this
// check inspects the parsed reference's `position` field. The forbidden
// selector is `self` (formerly `player`); numeric indices and `shared`
// are cross-client safe; `all` returns a list and is also safe.
const GAME_STAGE_FORBIDDEN_POSITIONS = new Set(["self"]);

/**
 * Validate that every `type: "timeline"` element's `source` names a
 * `type: "mediaPlayer"` element's `name` in the same step (stage, intro
 * step, or exit step). PlaybackHandles are step-scoped at runtime, so
 * a cross-step source would fail at render with a "source player not
 * found" error box — catching it at preflight gives authors immediate
 * feedback on typos.
 *
 * Called from both `stageSchema.superRefine` and
 * `introExitStepSchema.superRefine` since both step kinds can mix
 * timelines with mediaPlayers (e.g. a practice-annotation intro step).
 */
function validateTimelineSources(
  elements: Record<string, unknown>[],
  ctx: z.RefinementCtx,
  containerLabel: "stage" | "step" = "stage",
): void {
  // Track total mediaPlayer elements alongside the named set so the
  // error message can distinguish "no mediaPlayers at all" from
  // "mediaPlayers exist but all are unnamed."
  let totalMediaPlayers = 0;
  const mediaPlayerNames = new Set<string>();
  for (const element of elements) {
    if (
      element &&
      typeof element === "object" &&
      element.type === "mediaPlayer"
    ) {
      totalMediaPlayers++;
      if (typeof element.name === "string") {
        mediaPlayerNames.add(element.name);
      }
    }
  }
  elements.forEach((element, elementIndex) => {
    if (!element || typeof element !== "object" || element.type !== "timeline")
      return;
    const source = element.source;
    if (typeof source !== "string") return;
    // Skip when source is an unresolved `${field}` placeholder — the
    // referenced name may only be known after template fill.
    if (containsFieldPlaceholder(source)) return;
    if (mediaPlayerNames.has(source)) return;
    let available: string;
    if (mediaPlayerNames.size > 0) {
      available = ` Available mediaPlayers in this ${containerLabel}: ${[
        ...mediaPlayerNames,
      ]
        .map((n) => `"${n}"`)
        .join(", ")}.`;
    } else if (totalMediaPlayers > 0) {
      available = ` No mediaPlayer elements in this ${containerLabel} have a \`name:\` field — add one so timelines can reference them.`;
    } else {
      available = ` No mediaPlayer elements are defined in this ${containerLabel}.`;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["elements", elementIndex, "source"],
      message: `Timeline source "${source}" does not match any mediaPlayer.name in this ${containerLabel}.${available}`,
    });
  });
}

/**
 * Apply cross-cutting rules to a condition tree (stage-level or
 * element-level). Adds zod issues for each violation found; called
 * from stage/intro-exit superRefines so we can point issue paths at
 * the condition's actual location in the parent object.
 *
 * Walks the boolean tree (#235): if `conditions` is an array, treats
 * it as the implicit-`all` sugar; if it's an `{all|any|none: [...]}`
 * operator object, recurses through the children; if it's a leaf, the
 * per-leaf rules apply directly. Templates (`{template: ...}` nodes)
 * are skipped — they're checked after expansion against the resolved
 * shape, not pre-expansion.
 */
function validateConditionRules(
  conditions: unknown,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
  options: { contextLabel: string; forbidSelfPosition: boolean },
): void {
  if (conditions === undefined || conditions === null) return;

  // Implicit-all sugar: a top-level array iterates each child as a
  // sibling node (no `all` index in the path).
  if (Array.isArray(conditions)) {
    conditions.forEach((child, idx) => {
      validateConditionRules(child, [...pathPrefix, idx], ctx, options);
    });
    return;
  }

  if (typeof conditions !== "object") return;
  const node = conditions as Record<string, unknown>;

  // Operator nodes: recurse into their children, scoping the path
  // prefix with the operator key + child index.
  for (const op of OPERATOR_KEYS) {
    const children = node[op];
    if (Array.isArray(children)) {
      children.forEach((child, idx) => {
        validateConditionRules(child, [...pathPrefix, op, idx], ctx, options);
      });
      return;
    }
  }

  // Skip template invocations — content unknown until expansion.
  if ("template" in node) return;

  // Leaf condition: apply the per-leaf rules. The path prefix already
  // points at the condition's location.
  const c = node as {
    reference?: unknown;
    comparator?: unknown;
    value?: unknown;
  };

  // Game-stage conditions must evaluate identically on every client or
  // they'll desync (one player skips, the other renders). After #298
  // the position lives inside the reference itself; we extract it and
  // reject `self` (per-participant). Numeric slot indices, `shared`,
  // and `all` are cross-client safe.
  if (options.forbidSelfPosition) {
    const refPosition = extractReferencePosition(c.reference);
    if (
      typeof refPosition === "string" &&
      GAME_STAGE_FORBIDDEN_POSITIONS.has(refPosition)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, "reference"],
        message: `${options.contextLabel} conditions must use a cross-client position prefix on the reference (\`shared\`, a numeric slot index, or \`all\`) — got \`self\`. Per-participant references would let one participant skip the stage while the other renders it. For per-participant aggregation, wrap leaves in an \`all:\` or \`any:\` operator with explicit slot-index references.`,
      });
    }
  }
}

/**
 * Extract the position selector from a reference field, regardless of
 * whether the reference is in dotted-string form or already structured.
 * Returns `undefined` if the position can't be determined (e.g., the
 * reference is invalid or a template placeholder).
 */
function extractReferencePosition(
  reference: unknown,
): number | string | undefined {
  if (typeof reference === "string") {
    const parsed = parseDottedReference(reference);
    if (parsed.ok) return parsed.value.position;
    return undefined;
  }
  if (
    reference &&
    typeof reference === "object" &&
    "position" in reference &&
    (typeof (reference as { position: unknown }).position === "string" ||
      typeof (reference as { position: unknown }).position === "number")
  ) {
    return (reference as { position: number | string }).position;
  }
  return undefined;
}

// Field-level conditions schema (#235): accepts either a flat array
// (sugar for `all: [...]`) or a single node (operator or leaf).
//
// The pre-validation `superRefine` runs first to catch the most common
// authoring mistake — typos in operator-keyed nodes — before zod's
// union dispatch turns them into a confusing "didn't match any branch"
// error. Without this, writing `al: [...]` or `ANY: [...]` produces a
// pile of schema-mismatch errors instead of "did you mean `all`?".
const conditionsRawSchema = z
  .union(
    [
      z.array(conditionNodeSchema).nonempty(),
      conditionNodeSchema,
      // `${field}` placeholder accepted (#284) — substituted with a literal
      // array (or operator object) at fillTemplates time.
      fieldPlaceholderSchema,
    ],
    {
      required_error:
        "Expected an array of conditions, or an `all`/`any`/`none` operator object, or a single condition.",
      invalid_type_error:
        "Expected an array of conditions, or an `all`/`any`/`none` operator object, or a single condition.",
    },
  )
  .superRefine((data, ctx) => {
    // Pre-scan for operator-key typos on object inputs only. If the
    // user wrote a single object (not an array) and its keys look like
    // a near-miss for `all`/`any`/`none`, emit a hint *before* the
    // union's per-branch errors swamp the output.
    if (Array.isArray(data) || data === null || typeof data !== "object") {
      return;
    }
    const keys = Object.keys(data);
    if (keys.length !== 1) return;
    const key = keys[0];
    if ((OPERATOR_KEYS as readonly string[]).includes(key)) return;
    // Skip leaf conditions (have `comparator`) and template invocations
    // (have `template`).
    if (key === "comparator" || key === "template" || key === "reference") {
      return;
    }
    // Heuristic: lowercase prefix overlap with an operator. Catches
    // `al`, `ALL`, `any:`, `nones`, etc.
    const lower = key.toLowerCase();
    const suggestion = OPERATOR_KEYS.find(
      (op) =>
        op.startsWith(lower) ||
        lower.startsWith(op) ||
        levenshtein(op, lower) <= 1,
    );
    if (suggestion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: `Unrecognized condition operator "${key}". Did you mean "${suggestion}"? Boolean operators are "all", "any", and "none".`,
      });
    }
  });

export const conditionsSchema = altTemplateContext(conditionsRawSchema);

// One-edit Levenshtein distance — small enough to inline rather than
// pull in a dependency. Used by the typo heuristic above.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

export type ConditionType = z.infer<typeof conditionSchema>;

// ------------------ Players ------------------ //

export const playerSchema = z
  .object({
    position: positionSchema,
    title: z.string().max(25).optional(),
    // Use `conditionsSchema` so player-block eligibility conditions
    // accept the same forms as every other condition site (#235):
    // flat array (implicit `all`), or `all`/`any`/`none` operator
    // node, or a single leaf. Existing flat-array authored conditions
    // continue to validate unchanged.
    conditions: conditionsSchema.optional(),
  })
  .strict();
export type PlayerType = z.infer<typeof playerSchema>;

// ------------------ Elements ------------------ //

const elementBaseSchema = z
  .object({
    name: nameSchema.optional(),
    notes: z.string().optional(),
    // `file:` is intentionally NOT on the base schema — it's only valid on
    // element types that actually consume a resource (prompt, audio, image,
    // mediaPlayer). Per-type schemas declare it themselves so a stray
    // `file:` on (e.g.) `submitButton` fails strict-key validation at
    // preflight rather than being silently accepted. See #249.
    displayTime: displayTimeSchema.or(fieldPlaceholderSchema).optional(),
    hideTime: hideTimeSchema.or(fieldPlaceholderSchema).optional(),
    showToPositions: showToPositionsSchema
      .or(fieldPlaceholderSchema)
      .optional(),
    hideFromPositions: hideFromPositionsSchema
      .or(fieldPlaceholderSchema)
      .optional(),
    conditions: conditionsSchema.optional(),
    tags: z
      .array(z.string(), {
        invalid_type_error:
          "Expected an array for `tags`. Make sure each item starts with a dash (`-`) in YAML.",
      })
      .optional(),
  })
  .strict();

const audioSchema = elementBaseSchema
  .extend({
    type: z.literal("audio"),
    file: fileSchema,
    // Todo: check that file exists
  })
  .strict();

const imageSchema = elementBaseSchema
  .extend({
    type: z.literal("image"),
    file: fileSchema,
    // Todo: check that file exists
  })
  .strict();

const displaySchema = elementBaseSchema
  .extend({
    type: z.literal("display"),
    // Per #298 the position is part of the reference itself
    // (e.g. `all.prompt.recall.value` to render every participant's
    // value, `0.prompt.notes.value` to render position 0's). The
    // pre-#298 sibling `position:` field is removed.
    reference: referenceSchema,
  })
  .strict();

export const promptSchema = elementBaseSchema
  .extend({
    type: z.literal("prompt"),
    file: promptFilePathSchema,
    shared: z.boolean().optional(),
  })
  .strict();

const separatorSchema = elementBaseSchema
  .extend({
    type: z.literal("separator"),
    style: z.enum(["thin", "thick", "regular"]).optional(),
  })
  .strict();

const submitButtonSchema = elementBaseSchema
  .extend({
    type: z.literal("submitButton"),
    buttonText: z.string().max(50).optional(),
  })
  .strict();

/**
 * @deprecated `type: survey` is pending removal once Stagebook's module-reuse
 *   pattern lands. New treatment files should prefer prompt-based patterns
 *   where the survey can be expressed as a sequence of prompt elements. The
 *   schema still accepts it; the runtime emits a one-time warning per
 *   `surveyName` when a survey element is parsed (see `warnSurveyDeprecation`
 *   on the element-union outer superRefine).
 */
const surveySchema = elementBaseSchema
  .extend({
    type: z.literal("survey"),
    surveyName: z.string(),
  })
  .strict();

// One-time `survey` deprecation warning — keyed by surveyName so each unique
// survey logs at most once per process. Tracked for removal once the
// module-reuse pattern lands; until then `survey` keeps working.
const _warnedSurveys = new Set<string>();

// Format the user-supplied surveyName for safe inclusion in a one-line
// console message: JSON.stringify escapes quotes / control chars / newlines,
// then truncate so a pathological multi-kilobyte string can't blow out logs.
const MAX_SURVEY_NAME_LOG_CHARS = 200;
function formatSurveyNameForLog(surveyName: string): string {
  const escaped = JSON.stringify(surveyName);
  return escaped.length > MAX_SURVEY_NAME_LOG_CHARS
    ? `${escaped.slice(0, MAX_SURVEY_NAME_LOG_CHARS - 1)}…`
    : escaped;
}

function warnSurveyDeprecation(surveyName: string): void {
  if (_warnedSurveys.has(surveyName)) return;
  _warnedSurveys.add(surveyName);
  console.warn(
    `[stagebook] \`type: survey\` is deprecated and tracked for removal once a module-reuse pattern lands (surveyName: ${formatSurveyNameForLog(surveyName)}). Prefer prompt-based patterns where the survey can be expressed as a sequence of prompt elements.`,
  );
}

const timerSchema = elementBaseSchema
  .extend({
    type: z.literal("timer"),
    startTime: z.number().gt(0).optional(),
    endTime: z.number().gt(0).optional(),
    warnTimeRemaining: z.number().gt(0).optional(),
    // Todo: check that startTime < endTime
    // Todo: check that warnTimeRemaining < endTime - startTime
  })
  .strict();

const mediaPlayerControlsSchema = z
  .object({
    playPause: z.boolean().optional(),
    seek: z.boolean().optional(),
    step: z.boolean().optional(),
    speed: z.boolean().optional(),
  })
  .strict()
  .optional();

export const mediaPlayerSchema = elementBaseSchema
  .extend({
    type: z.literal("mediaPlayer"),
    // `file:` (renamed from `url:` in #249) — a fileSchema-resolvable
    // resource: relative path, asset:// URI, or http(s):// URL.
    file: fileSchema,
    playVideo: z.boolean().optional(),
    playAudio: z.boolean().optional(),
    captionsFile: fileSchema.optional(),
    startAt: z.number().nonnegative().or(fieldPlaceholderSchema).optional(),
    stopAt: z.number().positive().or(fieldPlaceholderSchema).optional(),
    allowScrubOutsideBounds: z.boolean().optional(),
    stepDuration: z.number().positive().or(fieldPlaceholderSchema).optional(),
    syncToStageTime: z.boolean().optional(),
    submitOnComplete: z.boolean().optional(),
    playback: z.enum(["once", "manual"]).optional(),
    controls: mediaPlayerControlsSchema,
  })
  .strict();

export type MediaPlayerType = z.infer<typeof mediaPlayerSchema>;

/**
 * mediaPlayer cross-field rules. Lives outside `mediaPlayerSchema` because
 * `z.discriminatedUnion` in Zod 3 only accepts plain `ZodObject` members
 * (not `ZodEffects` wrappers), so any `.refine`/`.superRefine` applied to a
 * member would break elementSchema's discriminated union. We apply these
 * rules from the union's outer superRefine instead — same behavior, same
 * error messages.
 */
function checkMediaPlayerCrossFields(
  data: z.infer<typeof mediaPlayerSchema>,
  ctx: z.RefinementCtx,
): void {
  // Only compare when both are concrete numbers — skip when either is an
  // unresolved ${field} placeholder.
  if (
    typeof data.startAt === "number" &&
    typeof data.stopAt === "number" &&
    data.stopAt <= data.startAt
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "stopAt must be greater than startAt",
      path: ["stopAt"],
    });
  }
  if (data.syncToStageTime && data.controls) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "controls cannot be specified when syncToStageTime is true (playback is locked to stage time)",
      path: ["controls"],
    });
  }
  if (data.playback === "once" && data.controls) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'controls cannot be specified when playback is "once" (participant controls are disabled)',
      path: ["controls"],
    });
  }
  if (data.playback === "once" && data.syncToStageTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'playback "once" cannot be combined with syncToStageTime (use syncToStageTime without playback instead)',
      path: ["playback"],
    });
  }
}

export const timelineSchema = elementBaseSchema
  .extend({
    type: z.literal("timeline"),
    source: nameSchema,
    name: nameSchema,
    selectionType: z.enum(["range", "point"]),
    selectionScope: z.enum(["track", "all"]).optional(),
    multiSelect: z.boolean().optional(),
    showWaveform: z.boolean().optional(),
    trackLabels: z
      .array(z.string(), {
        invalid_type_error:
          "Expected an array for `trackLabels`. Make sure each item starts with a dash (`-`) in YAML.",
      })
      .optional(),
  })
  .strict();

export type TimelineType = z.infer<typeof timelineSchema>;

const trackedLinkParamSchema = z
  .object({
    key: z.string().min(1),
    value: z
      .union([z.string(), z.number(), z.boolean(), fieldPlaceholderSchema])
      .optional(),
    // Per #298 the position is part of the reference itself.
    reference: referenceSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.value !== undefined && data.reference !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either `value` or `reference`, not both.",
        path: ["value"],
      });
    }
  });

const qualtricsSchema = elementBaseSchema
  .extend({
    type: z.literal("qualtrics"),
    url: browserUrlSchema,
    urlParams: z
      .array(trackedLinkParamSchema, {
        invalid_type_error:
          "Expected an array for `urlParams`. Make sure each item starts with a dash (`-`) in YAML.",
      })
      .optional(),
  })
  .strict();

// Element for instrumented external links (see client/src/elements/TrackedLink.jsx).
// We validate the static fields plus the structured urlParams array so that Typos get caught at preflight.
const trackedLinkSchema = elementBaseSchema
  .extend({
    type: z.literal("trackedLink"),
    name: nameSchema,
    url: browserUrlSchema,
    displayText: z.string().min(1),
    helperText: z.string().optional(),
    urlParams: z
      .array(trackedLinkParamSchema, {
        invalid_type_error:
          "Expected an array for `urlParams`. Make sure each item starts with a dash (`-`) in YAML.",
      })
      .optional(),
  })
  .strict();

export const validElementTypes = [
  "audio",
  "display",
  "image",
  "prompt",
  "qualtrics",
  "separator",
  "submitButton",
  // `survey` is deprecated (see surveySchema's JSDoc) but still accepted.
  "survey",
  "timer",
  "mediaPlayer",
  "timeline",
  "trackedLink",
] as const;

export const validComparators = [
  "exists",
  "doesNotExist",
  "equals",
  "doesNotEqual",
  "isAbove",
  "isBelow",
  "isAtLeast",
  "isAtMost",
  "hasLengthAtLeast",
  "hasLengthAtMost",
  "includes",
  "doesNotInclude",
  "matches",
  "doesNotMatch",
  "isOneOf",
  "isNotOneOf",
] as const;

export const validReferenceTypes = [
  ...namedSourceEnum.options,
  ...externalSourceEnum.options,
] as const;

// ------------------ Schema introspection ------------------ //
//
// These maps and getValidKeysFor* helpers expose the set of valid keys
// for each container kind, so authoring tools (VS Code diagnostics, the
// viewer's load error path, future autocomplete) can report rich
// "Unrecognized key 'X' on element of type 'survey'. Did you mean
// 'surveyName'? Valid keys: …" messages instead of the bare Zod default.
//
// Each per-element/per-condition schema in this file is a `ZodObject`
// (built via `elementBaseSchema.extend({...}).strict()` /
// `baseConditionSchema.extend({...}).strict()`), so `.shape` resolves
// directly to the merged key set without us having to re-list anything.

const elementSchemasByType = {
  audio: audioSchema,
  display: displaySchema,
  image: imageSchema,
  prompt: promptSchema,
  qualtrics: qualtricsSchema,
  separator: separatorSchema,
  submitButton: submitButtonSchema,
  survey: surveySchema,
  timer: timerSchema,
  mediaPlayer: mediaPlayerSchema,
  timeline: timelineSchema,
  trackedLink: trackedLinkSchema,
} as const;

const conditionSchemasByComparator = {
  exists: conditionExistsSchema,
  doesNotExist: conditionDoesNotExistSchema,
  equals: conditionEqualsSchema,
  doesNotEqual: conditionDoesNotEqualSchema,
  isAbove: conditionIsAboveSchema,
  isBelow: conditionIsBelowSchema,
  isAtLeast: conditionIsAtLeastSchema,
  isAtMost: conditionIsAtMostSchema,
  hasLengthAtLeast: conditionHasLengthAtLeastSchema,
  hasLengthAtMost: conditionHasLengthAtMostSchema,
  includes: conditionIncludesSchema,
  doesNotInclude: conditionDoesNotIncludeSchema,
  matches: conditionMatchesSchema,
  doesNotMatch: conditionDoesNotMatchSchema,
  isOneOf: conditionIsOneOfSchema,
  isNotOneOf: conditionIsNotOneOfSchema,
} as const;

/**
 * Return the list of valid keys allowed on an element of the given
 * `type`, or null if `type` is not a recognized element type. Keys are
 * returned in declaration order (base keys first, then per-type keys).
 */
export function getValidKeysForElementType(type: string): string[] | null {
  const schema = (
    elementSchemasByType as Record<string, { shape: Record<string, unknown> }>
  )[type];
  if (!schema) return null;
  return Object.keys(schema.shape);
}

/**
 * Return the list of valid keys allowed on a condition with the given
 * `comparator`, or null if `comparator` is not a recognized condition
 * comparator. Includes `comparator` and `value` along with the inherited
 * `reference` / `position` keys.
 */
export function getValidKeysForComparator(comparator: string): string[] | null {
  const schema = (
    conditionSchemasByComparator as Record<
      string,
      { shape: Record<string, unknown> }
    >
  )[comparator];
  if (!schema) return null;
  return Object.keys(schema.shape);
}

/**
 * Return the list of valid keys allowed on a stage. Hardcoded rather
 * than read from `stageSchema.shape` because stageSchema is wrapped in
 * `altTemplateContext(...).strict().superRefine(...)`, which produces a
 * `ZodEffects` that doesn't expose `.shape`. Keep in sync with
 * `stageSchema` above.
 */
export function getValidKeysForStage(): string[] {
  return ["name", "notes", "conditions", "discussion", "duration", "elements"];
}

/**
 * Return the list of valid keys allowed on an intro/exit step. Same
 * `ZodEffects` constraint as `getValidKeysForStage`. Keep in sync with
 * `introExitStepSchema` above.
 */
export function getValidKeysForIntroExitStep(): string[] {
  return ["name", "notes", "conditions", "elements"];
}

/**
 * Return the list of valid keys allowed on a treatment. Reads directly
 * from `baseTreatmentSchema.shape` (which is a plain `ZodObject` —
 * `treatmentSchema` is the wrapped form).
 */
export function getValidKeysForTreatment(): string[] {
  return Object.keys(baseTreatmentSchema.shape);
}

/**
 * Return the list of valid keys allowed on a discussion. Hardcoded —
 * `discussionSchema` is a `.strict().superRefine(...)` `ZodEffects`.
 * Keep in sync with `discussionSchema` above.
 */
export function getValidKeysForDiscussion(): string[] {
  return [
    "chatType",
    "showNickname",
    "showTitle",
    "showSelfView",
    "showReportMissing",
    "showAudioMute",
    "showVideoMute",
    "reactionEmojisAvailable",
    "reactToSelf",
    "numReactionsPerMessage",
    "layout",
    "rooms",
    "showToPositions",
    "hideFromPositions",
    "conditions",
  ];
}

/**
 * Return the list of valid keys allowed on a player block (an item in
 * a treatment's `groupComposition`). `playerSchema` is a plain
 * `ZodObject`, so we read `.shape` directly.
 */
export function getValidKeysForPlayer(): string[] {
  return Object.keys(playerSchema.shape);
}

export const elementSchema = altTemplateContext(
  z
    .discriminatedUnion("type", [
      audioSchema,
      displaySchema,
      imageSchema,
      promptSchema,
      qualtricsSchema,
      separatorSchema,
      submitButtonSchema,
      surveySchema,
      timerSchema,
      mediaPlayerSchema,
      timelineSchema,
      trackedLinkSchema,
    ])
    .superRefine((data, ctx) => {
      // Cross-field rules only run after base-shape validation succeeds —
      // an incomplete mediaPlayer (e.g. missing `url`) already errored
      // inside the discriminated union, so we never reach here for it.
      if (data.type === "mediaPlayer") {
        checkMediaPlayerCrossFields(data, ctx);
      }
      if (data.type === "survey") {
        warnSurveyDeprecation(data.surveyName);
      }
    }),
);

export type ElementType = z.infer<typeof elementSchema>;

export const elementsSchema = altTemplateContext(
  z
    .array(elementSchema, {
      required_error:
        "Expected an array for `elements`. Make sure each item starts with a dash (`-`) in YAML.",
      invalid_type_error:
        "Expected an array for `elements`. Make sure each item starts with a dash (`-`) in YAML.",
    })
    .nonempty(),
);

export type ElementsType = z.infer<typeof elementsSchema>;

// ------------------ Stages ------------------ //

export const stageSchema = altTemplateContext(
  z
    .object({
      name: nameSchema,
      notes: z.string().optional(),
      conditions: conditionsSchema.optional(),
      discussion: discussionSchema.optional(),
      duration: durationSchema.or(fieldPlaceholderSchema),
      elements: elementsSchema,
    })
    .strict()
    .superRefine((data, ctx) => {
      //For some reason, above conditions are bypassing the strict check
      // so we add a superRefine to check that elements field exists
      if (!data.elements) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stage must have elements field (check elementsSchema).",
        });
      }

      // Stage-level conditions (#183): forbid per-player positions on
      // game stages (would desync). After #238 the only cross-cutting
      // rule is `forbidSelfPosition` — `position` is a pure read
      // selector now (no more aggregator/percentAgreement values to
      // pair-check against the comparator).
      validateConditionRules(data.conditions, ["conditions"], ctx, {
        contextLabel: "Game-stage",
        forbidSelfPosition: true,
      });

      if (!Array.isArray(data.elements)) return;
      const elements = data.elements as Record<string, unknown>[];

      // Element-level conditions in game stages: elements render per
      // player, so per-player positions are fine here. After #238
      // there are no per-leaf cross-cutting rules to apply at the
      // element level — the call is kept as a hook for future rules
      // and parity with the stage-level walker.
      elements.forEach((element, elementIndex) => {
        if (element && typeof element === "object") {
          validateConditionRules(
            (element as { conditions?: unknown }).conditions,
            ["elements", elementIndex, "conditions"],
            ctx,
            { contextLabel: "Element", forbidSelfPosition: false },
          );
        }
      });

      // Validate element time bounds against stage duration
      const duration = data.duration;
      if (typeof duration === "number") {
        elements.forEach((element, elementIndex) => {
          if (!element || typeof element !== "object") return;

          const timeFields = [
            "displayTime",
            "hideTime",
            "startTime",
            "endTime",
          ] as const;
          for (const field of timeFields) {
            const value = element[field];
            if (typeof value === "number" && value > duration) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["elements", elementIndex, field],
                message: `${field} (${value}) exceeds stage duration (${duration}) for element "${String(element.name ?? element.type)}"`,
              });
            }
          }
        });
      }

      validateTimelineSources(elements, ctx);
    }),
);
export type StageType = z.infer<typeof stageSchema>;

const stagesSchema = altTemplateContext(
  z
    .array(stageSchema, {
      required_error:
        "Expected an array for `stages`. Make sure each item starts with a dash (`-`) in YAML.",
      invalid_type_error:
        "Expected an array for `stages`. Make sure each item starts with a dash (`-`) in YAML.",
    })
    .nonempty(),
);

export const introExitStepSchema = altTemplateContext(
  z
    .object({
      name: nameSchema,
      notes: z.string().optional(),
      conditions: conditionsSchema.optional(),
      elements: elementsSchema,
    })
    .strict()
    .superRefine((data, ctx) => {
      // Intro/exit steps are per-participant, so per-player positions
      // are fine here — no desync concern. After #238 there are no
      // per-leaf cross-cutting rules left here either; the call is
      // kept as a hook for future rules and so the walker still
      // recurses through operator nodes consistently.
      validateConditionRules(data.conditions, ["conditions"], ctx, {
        contextLabel: "Intro/exit step",
        forbidSelfPosition: false,
      });
      if (Array.isArray(data.elements)) {
        const elements = data.elements as Record<string, unknown>[];
        elements.forEach((element, elementIndex) => {
          if (element && typeof element === "object") {
            validateConditionRules(
              (element as { conditions?: unknown }).conditions,
              ["elements", elementIndex, "conditions"],
              ctx,
              { contextLabel: "Element", forbidSelfPosition: false },
            );
          }
        });
        // Same timeline-source validation as game stages: a timeline's
        // `source` must name a mediaPlayer in the same step. Intro and
        // exit steps can carry timeline+mediaPlayer pairs too (e.g. a
        // practice-annotation intro step).
        validateTimelineSources(elements, ctx, "step");
      }
    }),
);
// Intro/exit step conditions intentionally allow any `position` value —
// these steps are per-participant, so per-player positions don't desync.
// The original TODO about position-value restriction was superseded by
// #183; if we later want to forbid `showToPositions` /
// `hideFromPositions` on intro/exit elements (they render for one
// participant so those fields are no-ops), it belongs here.
export type IntroExitStepType = z.infer<typeof introExitStepSchema>;

export const introExitStepsBaseSchema = altTemplateContext(
  z
    .array(introExitStepSchema, {
      required_error:
        "Expected an array for `introSteps`. Make sure each item starts with a dash (`-`) in YAML.",
      invalid_type_error:
        "Expected an array for `introSteps`. Make sure each item starts with a dash (`-`) in YAML.",
    })
    .nonempty(),
);

// Backwards compatibility export for downstream packages still referencing the legacy name.
export const introExitStepsSchema = introExitStepsBaseSchema;

// Returns true if the element satisfies the advancement requirement for an
// intro/exit step: submitButton (explicit), survey/qualtrics (auto-submit on
// completion), or mediaPlayer with submitOnComplete: true (auto-submits when
// playback ends).
function isAdvancementElement(element: ElementType): boolean {
  if (!element || typeof element !== "object") return false;
  const el = element as Record<string, unknown>;
  if (el.type === "submitButton") return true;
  if (el.type === "survey") return true;
  if (el.type === "qualtrics") return true;
  if (el.type === "mediaPlayer" && el.submitOnComplete === true) return true;
  return false;
}

export const introStepsSchema = introExitStepsBaseSchema.superRefine(
  (data, ctx) => {
    data?.forEach((step: IntroExitStepType, stepIdx: number) => {
      if (Array.isArray(step.elements)) {
        step.elements.forEach((element: ElementType, elementIdx: number) => {
          if (
            element &&
            typeof element === "object" &&
            "shared" in element &&
            element.shared
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [stepIdx, "elements", elementIdx, "shared"],
              message: `Prompt element in intro/exit steps cannot be shared.`,
            });
          }
          if (element && typeof element === "object" && "position" in element) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [stepIdx, "elements", elementIdx, "position"],
              message: `Elements in intro steps cannot have a 'position' field.`,
            });
          }
          if (
            element &&
            typeof element === "object" &&
            "showToPositions" in element
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [stepIdx, "elements", elementIdx],
              message: `Elements in intro steps cannot have a 'showToPositions' field.`,
            });
          }
          if (
            element &&
            typeof element === "object" &&
            "hideFromPositions" in element
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [stepIdx, "elements", elementIdx],
              message: `Elements in intro steps cannot have a 'hideFromPositions' field.`,
            });
          }
        });

        if (!step.elements.some(isAdvancementElement)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [stepIdx, "elements"],
            message:
              "Intro/exit step must include at least one advancement element: submitButton, survey, qualtrics, or mediaPlayer with submitOnComplete: true.",
          });
        }
      }
    });
  },
);

export const exitStepsSchema = introExitStepsBaseSchema.superRefine(
  (data, ctx) => {
    data?.forEach((step: IntroExitStepType, stepIdx: number) => {
      if (Array.isArray(step.elements)) {
        step.elements.forEach((element: ElementType, elementIdx: number) => {
          if (
            element &&
            typeof element === "object" &&
            "shared" in element &&
            element.shared
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [stepIdx, "elements", elementIdx, "shared"],
              message: `Prompt element in intro/exit steps cannot be shared.`,
            });
          }
        });

        if (!step.elements.some(isAdvancementElement)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [stepIdx, "elements"],
            message:
              "Intro/exit step must include at least one advancement element: submitButton, survey, qualtrics, or mediaPlayer with submitOnComplete: true.",
          });
        }
      }
    });
  },
);

// ------------------ Intro Sequences and Treatments ------------------ //
export const introSequenceSchema = altTemplateContext(
  z
    .object({
      name: nameSchema,
      notes: z.string().optional(),
      // Participant-facing language for this intro sequence (BCP-47, e.g.
      // `he`). Intro sequences run BEFORE treatment assignment, so they can't
      // inherit a treatment's locale — they declare their own. Same semantics
      // as the treatment field: optional (absent = English), accepts a
      // `${field}` placeholder for single-source `contentType: introSequence`
      // templates, concrete value enum-shape-checked post-fill. Which locale
      // a participant actually sees here is the host's assignment decision
      // (intro selection is pre-arm); stagebook just renders what's declared.
      locale: localeSchema.or(fieldPlaceholderSchema).optional(),
      introSteps: introStepsSchema,
    })
    .strict(),
);
export type IntroSequenceType = z.infer<typeof introSequenceSchema>;

export const introSequencesSchema = altTemplateContext(
  z
    .array(introSequenceSchema, {
      required_error:
        "Expected an array for `introSequence`. Make sure each item starts with a dash (`-`) in YAML.",
      invalid_type_error:
        "Expected an array for `introSequence`. Make sure each item starts with a dash (`-`) in YAML.",
    })
    .nonempty(),
);

export const baseTreatmentSchema = z
  .object({
    name: nameSchema,
    notes: z.string().optional(),
    playerCount: z.number(),
    // Participant-facing language for this treatment (BCP-47, e.g. `he`).
    // Drives stagebook's chrome catalog + RTL when the host wires it onto the
    // provider. Optional — absent means English (the runtime resolves an
    // absent/unknown locale to `en`). Accepts a `${field}` placeholder so one
    // `contentType: treatment` template can fan out per-locale arms, threading
    // the same field into both `locale:` and `prompts/${locale}/…` paths; the
    // concrete value is enum-shape-checked post-fill by `resolvedTreatmentSchema`.
    locale: localeSchema.or(fieldPlaceholderSchema).optional(),
    // `${field}` placeholder accepted (#284) — substituted with a literal
    // array at fillTemplates time. Lets a single `treatment` template power
    // studies that vary group structure per condition (e.g. dyads vs.
    // triads under the same protocol).
    groupComposition: z
      .array(playerSchema, {
        invalid_type_error:
          "Expected an array for `groupComposition`. Make sure each item starts with a dash (`-`) in YAML.",
      })
      .or(fieldPlaceholderSchema)
      .optional(),
    gameStages: stagesSchema,
    exitSequence: exitStepsSchema.optional(),
  })
  .strict();

export const treatmentSchema = altTemplateContext(
  baseTreatmentSchema
    //works currently for the case where playerSchema always occurs within a treatmentSchema
    //However if a playerSchema is used outside of a treatmentSchema, this will not work, as playerCount will not be defined in its scope
    //With the current structure of templateSchema, this is hypothetically possible, but unlikely
    .superRefine((treatment, ctx) => {
      const baseResult = baseTreatmentSchema.safeParse(treatment);
      if (!baseResult.success) {
        return;
      }
      const { playerCount, groupComposition, gameStages } = treatment;
      // groupComposition may be an array (literal) or a string (`${field}`
      // placeholder, #284). Skip the array-iteration checks when it's a
      // placeholder; resolved.ts catches unsubstituted strings post-fill.
      if (Array.isArray(groupComposition)) {
        groupComposition.forEach((player, index) => {
          if (
            typeof player.position === "number" &&
            player.position >= playerCount
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["groupComposition", index, "position"],
              message: `Player position index ${player.position} in groupComposition exceeds playerCount of ${playerCount}.`,
            });
          }
        });
        const positions = groupComposition
          .map((player) => player.position)
          .filter((pos) => typeof pos === "number");
        const uniquePositions = new Set(positions);
        if (uniquePositions.size !== positions.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["groupComposition"],
            message: `Player positions in groupComposition must be unique.`,
          });
        }
        const expectedPositions = Array.from(
          { length: playerCount },
          (_, i) => i,
        );
        const missingPositions = expectedPositions.filter(
          (pos) => !uniquePositions.has(pos),
        );
        if (missingPositions.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["groupComposition"],
            message: `Player positions in groupComposition must include all nonnegative integers below playerCount (${playerCount}). Missing: ${missingPositions.join(", ")}.`,
          });
        }
      }
      gameStages?.forEach(
        (
          stage: {
            elements?: Record<string, unknown>[];
            name?: string;
            discussion?: Record<string, unknown>;
          },
          stageIndex: number,
        ) => {
          stage?.elements?.forEach(
            (element: Record<string, unknown>, elementIndex: number) => {
              ["showToPositions", "hideFromPositions"].forEach((key) => {
                const positions = element[key];
                if (Array.isArray(positions)) {
                  positions?.forEach((pos, posIndex) => {
                    if (typeof pos === "number" && pos >= playerCount) {
                      ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [
                          "gameStages",
                          stageIndex,
                          "elements",
                          elementIndex,
                          key,
                          posIndex,
                        ],
                        message: `${key} index ${pos} in stage "${stage.name}" exceeds playerCount of ${playerCount}.`,
                      });
                    }
                  });
                }
              });
            },
          );

          const discussion = stage?.discussion;
          if (discussion) {
            ["showToPositions", "hideFromPositions"].forEach((key) => {
              const positions = discussion?.[key];
              if (Array.isArray(positions)) {
                positions.forEach((pos, posIndex) => {
                  if (typeof pos === "number" && pos >= playerCount) {
                    ctx.addIssue({
                      code: z.ZodIssueCode.custom,
                      path: [
                        "gameStages",
                        stageIndex,
                        "discussion",
                        key,
                        posIndex,
                      ],
                      message: `${key} index ${pos} in discussion of stage "${stage.name}" exceeds playerCount of ${playerCount}.`,
                    });
                  }
                });
              }
            });

            const { rooms, showToPositions, hideFromPositions } =
              discussion || {};
            if (Array.isArray(rooms) && rooms.length > 0) {
              const allPositions: number[] = Array.from(
                { length: playerCount },
                (_, i) => i,
              );
              let candidatePositions = allPositions;
              if (
                Array.isArray(showToPositions) &&
                showToPositions.length > 0
              ) {
                candidatePositions = candidatePositions.filter((p) =>
                  showToPositions.includes(p),
                );
              }
              if (
                Array.isArray(hideFromPositions) &&
                hideFromPositions.length > 0
              ) {
                candidatePositions = candidatePositions.filter(
                  (p) => !hideFromPositions.includes(p),
                );
              }

              const assigned = new Set<number>();
              rooms.forEach(
                (room: Record<string, unknown>, roomIndex: number) => {
                  const inc = room?.includePositions;
                  if (Array.isArray(inc)) {
                    inc.forEach((pos: unknown, posIndex: number) => {
                      if (typeof pos === "number") {
                        assigned.add(pos);
                        if (pos >= playerCount) {
                          ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: [
                              "gameStages",
                              stageIndex,
                              "discussion",
                              "rooms",
                              roomIndex,
                              "includePositions",
                              posIndex,
                            ],
                            message: `includePositions index ${pos} in discussion room exceeds playerCount of ${playerCount}.`,
                          });
                        }
                      }
                    });
                  }
                },
              );

              const missing = candidatePositions.filter(
                (p) => !assigned.has(p),
              );
              if (missing.length > 0) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ["gameStages", stageIndex, "discussion", "rooms"],
                  message: `Rooms defined but the following visible player positions are not assigned to any room: ${missing.join(
                    ", ",
                  )}. Each visible position (respecting showToPositions/hideFromPositions) must appear in one includePositions array.`,
                });
              }
            }
          }
        },
      );
    }),
);

export type TreatmentType = z.infer<typeof treatmentSchema>;

export const treatmentsSchema = altTemplateContext(
  z
    .array(treatmentSchema, {
      required_error:
        "Expected an array for `treatments`. Make sure each item starts with a dash (`-`) in YAML.",
      invalid_type_error:
        "Expected an array for `treatments`. Make sure each item starts with a dash (`-`) in YAML.",
    })
    .nonempty(),
);

// ------------------ Template Schemas ------------------ //

// Whole-treatment groupComposition (an array of player blocks). Exposed as
// a contentType so a complete group config can be templated as one unit.
// `${field}` placeholder accepted (#284) — substituted with a literal
// array at fillTemplates time.
export const groupCompositionSchema = z
  .array(playerSchema)
  .nonempty()
  .or(fieldPlaceholderSchema);

export const contentTypeEnum = z.enum([
  "introSequence",
  "introSequences",
  "elements",
  "element",
  "stage",
  "stages",
  "treatment",
  "treatments",
  "reference",
  "condition",
  "conditions",
  "player",
  "groupComposition",
  "introExitStep",
  "introSteps",
  "exitSteps",
  "discussion",
  "broadcastAxisValues",
]);

export type ContentType = z.infer<typeof contentTypeEnum>;

export function matchContentType(contentType: ContentType): z.ZodTypeAny {
  switch (contentType) {
    case "introSequence":
      return introSequenceSchema;
    case "introSequences":
      return introSequencesSchema;
    case "elements":
      return elementsSchema;
    case "element":
      return elementSchema;
    case "stage":
      return stageSchema;
    case "stages":
      return stagesSchema;
    case "treatment":
      return treatmentSchema;
    case "treatments":
      return treatmentsSchema;
    case "reference":
      return referenceSchema;
    case "condition":
      return conditionSchema;
    case "conditions":
      return conditionsSchema;
    case "player":
      return playerSchema;
    case "groupComposition":
      return groupCompositionSchema;
    case "introExitStep":
      return introExitStepSchema;
    case "introSteps":
      return introStepsSchema;
    case "exitSteps":
      return exitStepsSchema;
    case "discussion":
      return discussionSchema;
    case "broadcastAxisValues":
      return templateBroadcastAxisValuesSchema;
    default: {
      // Belt-and-suspenders: TS guarantees exhaustiveness over `ContentType`,
      // but the function is exported and could be called from JS with an
      // arbitrary string. Fail loudly rather than returning `undefined`.
      const _exhaustive: never = contentType;
      throw new Error(`Unknown contentType: ${String(_exhaustive)}`);
    }
  }
}

export const templateSchema = z
  .object({
    name: nameSchema,
    contentType: contentTypeEnum,
    notes: z.string().optional(),
    content: z.any(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const result = matchContentType(data.contentType).safeParse(data.content);
    if (!result.success) {
      result.error.issues.forEach((issue) =>
        ctx.addIssue({
          ...issue,
          path: ["content", ...issue.path],
          message: `Invalid content for contentType '${data.contentType}': ${issue.message}`,
        }),
      );
    }
  });

export type TemplateType = z.infer<typeof templateSchema>;

// ------------------ Treatment File ------------------ //
// Per #277, the file shape is unified: there is no separate "module
// file" type. A Stagebook file may have any subset of `templates:`,
// `treatments:`, `introSequences:`, and `imports:` — the same file
// can be a runtime entry point (with `treatments:`) and an importable
// source (whose `templates:` get merged into another study). Hosts
// enforce "an entry-point file must have at least one treatment" at
// load time, not at the schema level.
export const treatmentFileSchema = z
  .object({
    /**
     * Relative paths to other Stagebook files whose `templates:`
     * should be merged in before expansion. Resolved by
     * `resolveImportPath` + `resolveImports` (#277). The schema
     * permits the field; the host's loading loop is what actually
     * fetches the imports.
     */
    imports: z.array(z.string().min(1)).optional(),
    templates: z
      .array(templateSchema)
      .min(1, "Templates cannot be empty")
      .optional(),
    introSequences: introSequencesSchema.optional(),
    treatments: treatmentsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    // Cross-stage reference validation (#197): forward-reference rejection
    // + stage-level always-skip-at-load detection. Walker lives in its
    // own module to keep this file focused.
    for (const issue of validateTreatmentFileReferences(data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path,
        message: issue.message,
      });
    }
    // Storage-key collision detection (#281): every `{type}_{name}` key
    // must be unique across every phase of the treatment. Authors who
    // need the same prompt file in multiple places use the per-element
    // `name:` override to disambiguate.
    for (const collision of collectStorageKeyCollisions(data)) {
      for (const path of collision.paths) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: collision.message,
        });
      }
    }
  });
export type TreatmentFileType = z.infer<typeof treatmentFileSchema>;
