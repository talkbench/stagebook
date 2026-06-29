/**
 * Resolved (post-hydration) schemas for component consumption.
 *
 * These schemas describe what treatment data looks like AFTER template
 * expansion — no template contexts, no ${field} placeholders. They provide
 * proper TypeScript types for Stage, Element, and other component props.
 *
 * The full schemas in treatment.ts (with altTemplateContext wrappers) are
 * used for validating raw treatment files. These resolved schemas are used
 * by rendering components that only see hydrated data.
 */
import { z } from "zod";
import { localeSchema } from "./primitives.js";
import {
  nameSchema,
  durationSchema,
  displayTimeSchema,
  hideTimeSchema,
  positionSchema,
  showToPositionsSchema,
  hideFromPositionsSchema,
  discussionSchema,
  referenceSchema,
  promptFilePathSchema,
} from "./treatment.js";

// Detects `${field}` placeholders that survived `fillTemplates` —
// either because the field wasn't bound or because a typo broke
// the substitution. Used by the resolved-stage superRefine below
// to flag any stringly field that should have resolved to a
// literal by the time we reach the post-fill schema.
const FIELD_PLACEHOLDER_RE = /\$\{[^}]*\}/;

// ----------------------------------------------------------------
// Resolved condition — no template placeholders in values
// ----------------------------------------------------------------

// Leaf shape of a resolved condition: reference + comparator + optional
// value, no template placeholders. Boolean-tree operators (#235) are
// described separately below. After #298 the position lives inside the
// reference; the sibling `position:` field is removed (mirrors
// `baseConditionSchema` in treatment.ts).
const resolvedLeafConditionSchema = z
  .object({
    reference: referenceSchema,
    comparator: z.enum([
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
    ]),
    value: z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string().or(z.number())),
      ])
      .optional(),
  })
  .strict();

// Recursive resolved-condition node: an `all`/`any`/`none` operator,
// or a leaf. After template fill, the same boolean tree is what
// runtime/component code sees — no template placeholders, no string
// shorthand quirks, just the structured form.
//
// The schema itself is untyped (`z.ZodType`) because the leaf's
// `reference` field uses `referenceSchema`, which transforms a dotted
// string into a string[] path — input and output types differ, and
// `z.ZodType<T>` parameterized on a single type would force them
// equal and break the dts build. The structural TS type
// `ResolvedConditionNode` is exported separately for consumers that
// want to type-narrow against the union; `ResolvedConditionType`
// stays as a backward-compat alias.
const resolvedConditionNodeSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ all: z.array(resolvedConditionNodeSchema).nonempty() }).strict(),
    z.object({ any: z.array(resolvedConditionNodeSchema).nonempty() }).strict(),
    z
      .object({ none: z.array(resolvedConditionNodeSchema).nonempty() })
      .strict(),
    resolvedLeafConditionSchema,
  ]),
);

// Backward-compat alias: `resolvedConditionSchema` previously meant a
// single leaf; it now means any node in the tree (leaf or operator).
const resolvedConditionSchema = resolvedConditionNodeSchema;

// Structural TS type for the resolved boolean tree. Exposed so
// consumers (host components, custom evaluators) can type their
// `conditions` props as `ResolvedConditionNode | ResolvedConditionNode[]`
// rather than falling through to `any` from the lazy schema.
export type ResolvedConditionLeaf = z.infer<typeof resolvedLeafConditionSchema>;
export type ResolvedConditionNode =
  | { all: ResolvedConditionNode[] }
  | { any: ResolvedConditionNode[] }
  | { none: ResolvedConditionNode[] }
  | ResolvedConditionLeaf;

// Field-level shape: array (implicit-`all` sugar) or a single node.
// Mirrors `conditionsSchema` in treatment.ts.
const resolvedConditionsSchema = z
  .union([
    z.array(resolvedConditionNodeSchema).nonempty(),
    resolvedConditionNodeSchema,
  ])
  .optional();

// ----------------------------------------------------------------
// Resolved element — concrete type union, no placeholders
// ----------------------------------------------------------------

const resolvedElementBaseSchema = z.object({
  type: z.string(),
  name: nameSchema.optional(),
  file: z.string().optional(),
  displayTime: displayTimeSchema.optional(),
  hideTime: hideTimeSchema.optional(),
  showToPositions: showToPositionsSchema.optional(),
  hideFromPositions: hideFromPositionsSchema.optional(),
  conditions: resolvedConditionsSchema,
  tags: z.array(z.string()).optional(),
  // Allow additional fields for specific element types
  shared: z.boolean().optional(),
  buttonText: z.string().optional(),
  url: z.string().optional(),
  displayText: z.string().optional(),
  helperText: z.string().optional(),
  reference: z.string().optional(),
  surveyName: z.string().optional(),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
  warnTimeRemaining: z.number().optional(),
  style: z.enum(["thin", "regular", "thick", ""]).optional(),
  width: z.number().optional(),
  urlParams: z
    .array(
      z.object({
        key: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
        reference: z.string().optional(),
      }),
    )
    .optional(),
  // mediaPlayer fields
  syncToStageTime: z.boolean().optional(),
  submitOnComplete: z.boolean().optional(),
  playVideo: z.boolean().optional(),
  playAudio: z.boolean().optional(),
  captionsFile: z.string().optional(),
  startAt: z.number().optional(),
  stopAt: z.number().optional(),
  allowScrubOutsideBounds: z.boolean().optional(),
  stepDuration: z.number().optional(),
  controls: z
    .object({
      playPause: z.boolean().optional(),
      seek: z.boolean().optional(),
      step: z.boolean().optional(),
      speed: z.boolean().optional(),
    })
    .optional(),
});

// Post-fill validation contract (#398). After `fillTemplates`, the
// `file:` on a prompt element must:
//   1. Carry no unresolved `${field}` placeholder (annotator/host left
//      a slot unbound — would surface to the participant as a broken
//      file path).
//   2. End in `.prompt.md` (mirrors the pre-fill `promptFilePathSchema`
//      from treatment.ts — the pre-fill check is now relaxed for
//      `${...}`-containing strings, so this is where the strict
//      enforcement actually lives).
//
// Other stringly fields (`url`, `displayText`, `reference`, etc.) are
// NOT checked for placeholders here yet — the file path was the
// immediate motivation (#398). Adding the same placeholder-leak guard
// to those is a follow-up sweep once the pattern is proven.
export const resolvedElementSchema = resolvedElementBaseSchema.superRefine(
  (data, ctx) => {
    if (data.type === "prompt" && typeof data.file === "string") {
      if (FIELD_PLACEHOLDER_RE.test(data.file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["file"],
          message: `prompt.file contains an unresolved \`${data.file}\` placeholder. The template field was not bound during fillTemplates — check the broadcast row, additionalFields, or annotator binding.`,
          // Callers in authoring contexts (e.g. the VS Code extension)
          // can filter these out via `skipUnresolved: true` on
          // `validateResolvedTreatmentFile` — placeholders are
          // expected when the host hasn't bound fields yet.
          params: { reason: "unresolved-placeholder" },
        });
        return;
      }
      const fileCheck = promptFilePathSchema.safeParse(data.file);
      if (!fileCheck.success) {
        for (const issue of fileCheck.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["file", ...issue.path],
            message: issue.message,
          });
        }
      }
    }
  },
);
export type ResolvedElementType = z.infer<typeof resolvedElementSchema>;

// ----------------------------------------------------------------
// Resolved stage — concrete duration, resolved elements
// ----------------------------------------------------------------

// `discussionSchema` accepts `${field}` placeholders for `rooms` and
// `layout.feeds` (#284) so authors can template-fill those slots. The
// resolved-shape contract is "no placeholders survive substitution," so
// we add a superRefine here that flags any placeholder string still
// present after fillTemplates ran. Catches typos and missing fields
// that would otherwise reach runtime components.
const resolvedDiscussionSchema = discussionSchema.superRefine((data, ctx) => {
  if (typeof data.rooms === "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rooms"],
      message: `discussion.rooms is an unresolved \`${data.rooms}\` placeholder. The template field was not bound during fillTemplates — check the broadcast row or additionalFields.`,
      params: { reason: "unresolved-placeholder" },
    });
  }
  if (data.layout && typeof data.layout === "object") {
    for (const [seat, layoutDef] of Object.entries(data.layout)) {
      if (
        layoutDef &&
        typeof layoutDef === "object" &&
        "feeds" in layoutDef &&
        typeof layoutDef.feeds === "string"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layout", seat, "feeds"],
          message: `discussion.layout[${seat}].feeds is an unresolved \`${layoutDef.feeds}\` placeholder. The template field was not bound during fillTemplates.`,
          params: { reason: "unresolved-placeholder" },
        });
      }
    }
  }
});

export const resolvedStageSchema = z.object({
  name: nameSchema,
  discussion: resolvedDiscussionSchema.optional(),
  duration: durationSchema,
  elements: z.array(resolvedElementSchema).nonempty(),
});
export type ResolvedStageType = z.infer<typeof resolvedStageSchema>;

// ----------------------------------------------------------------
// Resolved intro/exit step — no duration, no position visibility
// ----------------------------------------------------------------

export const resolvedIntroExitStepSchema = z.object({
  name: nameSchema,
  elements: z.array(resolvedElementSchema).nonempty(),
});
export type ResolvedIntroExitStepType = z.infer<
  typeof resolvedIntroExitStepSchema
>;

// ----------------------------------------------------------------
// Resolved treatment — concrete playerCount, resolved stages
// ----------------------------------------------------------------

export const resolvedTreatmentSchema = z.object({
  name: nameSchema,
  playerCount: z.number(),
  // Post-fill the locale is a concrete BCP-47 tag — no `${field}` placeholder
  // (a leaked placeholder fails the syntactic check, surfacing an unbound
  // locale). Optional; absent means English.
  locale: localeSchema.optional(),
  groupComposition: z
    .array(
      z.object({
        position: positionSchema,
        title: z.string().max(25).optional(),
        conditions: resolvedConditionsSchema,
      }),
    )
    .optional(),
  gameStages: z.array(resolvedStageSchema).nonempty(),
  exitSequence: z.array(resolvedIntroExitStepSchema).optional(),
});
export type ResolvedTreatmentType = z.infer<typeof resolvedTreatmentSchema>;

// ----------------------------------------------------------------
// Resolved treatment file (#398) — post-fill outer envelope
// ----------------------------------------------------------------
//
// `treatmentFileSchema` in treatment.ts is the pre-fill schema —
// every stringly field accepts `${field}` placeholders. After
// `fillTemplates` has run (host bound the placeholders), call
// `validateResolvedTreatmentFile(filled)` to catch leaks that
// would surface to participants:
//
//   - prompt.file values that lack `.prompt.md` (mirror of the
//     pre-fill `promptFilePathSchema`).
//   - prompt.file values that still carry a `${field}` placeholder
//     (annotator forgot to bind a slot).
//   - discussion.rooms / layout.feeds with unresolved placeholders
//     (the existing pattern from `resolvedDiscussionSchema`).
//
// The schema deliberately omits cross-treatment refinements
// (forward-reference checks, storage-key collisions, etc.) — those
// are pre-fill static-shape checks that already run via
// `treatmentFileSchema.superRefine`. The resolved schema's job is
// strictly to catch what fillTemplates could have introduced or
// failed to clear.

const resolvedIntroSequenceSchema = z.object({
  name: nameSchema,
  // Post-fill: a concrete BCP-47 tag (a leaked `${field}` placeholder fails
  // the syntactic check). Optional; absent means English.
  locale: localeSchema.optional(),
  introSteps: z.array(resolvedIntroExitStepSchema).nonempty(),
});

export const resolvedTreatmentFileSchema = z.object({
  imports: z.array(z.string().min(1)).optional(),
  // `templates:` is stripped by `fillTemplates` so it's not in the
  // post-fill shape. Keep the field permissively typed in case a
  // caller passes a not-yet-stripped tree.
  templates: z.array(z.unknown()).optional(),
  introSequences: z.array(resolvedIntroSequenceSchema).optional(),
  treatments: z.array(resolvedTreatmentSchema).optional(),
});
export type ResolvedTreatmentFileType = z.infer<
  typeof resolvedTreatmentFileSchema
>;

export interface ValidateResolvedOptions {
  /**
   * When `true`, drop any issue marked
   * `params.reason === "unresolved-placeholder"`. Use in authoring
   * contexts (e.g. the VS Code extension's expansion preview)
   * where `${field}` placeholders are expected because the host
   * hasn't bound them yet. Production hosts (annotator,
   * deliberation-lab) leave this off so unbound fields surface as
   * errors before the participant sees a broken page.
   */
  skipUnresolved?: boolean;
}

export interface ValidateResolvedIssue {
  path: (string | number)[];
  message: string;
  /** Discriminator copied from the underlying Zod issue's `params`. */
  reason?: string;
}

/**
 * Validate a fully-filled treatment file against the post-fill
 * resolved-schema contract (#398).
 *
 * Use this after `fillTemplates` (or any equivalent host hydration
 * step) to catch issues that would otherwise surface to participants
 * — e.g. a prompt.file that still contains `${field}` because the
 * annotator left a slot unbound, or a file path that doesn't end
 * in `.prompt.md`.
 *
 * Returns a normalized `{ success, issues }` shape so callers don't
 * have to thread Zod's error type through their own error reporting.
 */
export function validateResolvedTreatmentFile(
  filled: unknown,
  options: ValidateResolvedOptions = {},
): {
  success: boolean;
  issues: ValidateResolvedIssue[];
} {
  const result = resolvedTreatmentFileSchema.safeParse(filled);
  if (result.success) return { success: true, issues: [] };
  let issues: ValidateResolvedIssue[] = result.error.issues.map((issue) => {
    const params =
      issue.code === "custom"
        ? ((issue as { params?: unknown }).params as
            | { reason?: string }
            | undefined)
        : undefined;
    return {
      path: [...issue.path],
      message: issue.message,
      reason: params?.reason,
    };
  });
  if (options.skipUnresolved) {
    issues = issues.filter((i) => i.reason !== "unresolved-placeholder");
  }
  return { success: issues.length === 0, issues };
}

// ----------------------------------------------------------------
// Re-export resolved condition type
// ----------------------------------------------------------------

export { resolvedConditionSchema, resolvedConditionsSchema };
// `ResolvedConditionType` previously inferred from the leaf-only
// schema; now aliases the structural tree type so consumers keep type
// safety. (`z.infer` on the recursive `z.ZodType` lazy widens to
// `any` — see the comment above `resolvedConditionNodeSchema`.)
export type ResolvedConditionType = ResolvedConditionNode;
