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
  validateConditionRules,
  type DiscussionType,
  type DiscussionRoomType,
  type LayoutFeedType,
  type LayoutDefinitionType,
} from "./treatment.js";

// Detects `${field}` placeholders that survived `fillTemplates` —
// either because the field wasn't bound or because a typo broke
// the substitution. Used by the resolved-stage superRefine below
// to flag any stringly field that should have resolved to a
// literal by the time we reach the post-fill schema.
const FIELD_PLACEHOLDER_RE = /\$\{[^}]*\}/;

// The sweep uses the NARROW placeholder grammar (identifier bodies only),
// matching `fillTemplates` (FIELD_PLACEHOLDER_REGEX in templates/). A leak is
// specifically an `${identifier}` that fillTemplates WOULD have substituted but
// didn't (unbound field). A literal like `buttonText: "${form.id}"` (dot body)
// is never a fill placeholder, so it must NOT be flagged (#568 review).
const SWEEP_PLACEHOLDER_RE = /\$\{[a-zA-Z0-9_]+\}/;

// #568 — resolved placeholder-leak sweep. The per-field resolved guards
// (prompt.file, rooms/feeds, showTitle/showNickname) only cover slots
// someone explicitly checked, and slots whose resolved type is a
// number/array reject a surviving `"${x}"` by type mismatch. But
// *string-typed* slots — condition `value` (equals/includes/matches),
// element `url`/`displayText`/`reference`/`helperText`/`buttonText`/
// `altText`/`surveyName`, `urlParams[].value` — accept `"${x}"` as a
// structurally valid string and let it through silently, so at runtime a
// condition compares against the literal `"${x}"` and never matches, or a
// truthy string inverts a flag. This walks the whole filled tree and
// reports any surviving `${…}` in any string, tagged
// `unresolved-placeholder` (so `skipUnresolved` still filters it in
// authoring contexts). Mirrors the annotator's hand-rolled global scan
// (`resolveTask`); see the sweep issue. Findings are deduped against the
// per-field guards in `validateResolvedTreatmentFile` so a leak is
// reported once, preferring the guard's more specific message.
function collectPlaceholderLeaks(
  node: unknown,
  path: (string | number)[],
  out: { path: (string | number)[]; token: string }[],
): void {
  if (typeof node === "string") {
    const match = SWEEP_PLACEHOLDER_RE.exec(node);
    if (match) out.push({ path, token: match[0] });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      collectPlaceholderLeaks(item, [...path, index], out),
    );
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      // Skip the file-level `templates:` / `imports:` blocks. Template
      // definitions are a lookup table (not runtime content) and legitimately
      // contain `${field}` placeholders; the resolved schema tolerates a
      // not-yet-stripped tree (`templates: z.unknown()`), so the sweep must
      // too, or it false-positives on every placeholder in a definition
      // (#568 review). Only skipped at the top level (path.length === 0) —
      // no nested runtime object carries these keys.
      if (path.length === 0 && (key === "templates" || key === "imports")) {
        continue;
      }
      collectPlaceholderLeaks(value, [...path, key], out);
    }
  }
}

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
  // image alt text (#536) — the resolved (post-fill) form the runtime reads.
  altText: z.string().optional(),
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
  // `showNickname` / `showTitle` accept a `${field}` placeholder pre-fill
  // (#565). A string reaching the resolved shape means the template field was
  // never bound — flag it instead of letting the widened `boolean | string`
  // type carry a placeholder into a runtime component.
  for (const flag of ["showNickname", "showTitle"] as const) {
    if (typeof data[flag] === "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [flag],
        message: `discussion.${flag} is an unresolved \`${data[flag]}\` placeholder. The template field was not bound during fillTemplates — check the broadcast row or additionalFields.`,
        params: { reason: "unresolved-placeholder" },
      });
    }
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

// #567 — the narrowed, runtime discussion type. `discussionSchema` accepts
// `${field}` placeholders, so `DiscussionType` is widened (`showTitle: boolean
// | string`, `rooms: DiscussionRoomType[] | string`, `layout[].feeds` widened).
// That authoring type is right pre-fill, but the RUNTIME seam (renderDiscussion,
// StageConfig, the viewer step model) only ever sees a *resolved* config:
// `resolvedDiscussionSchema` above rejects any surviving placeholder and the
// file-level sweep (#569) is the backstop, so the value handed to those
// consumers is guaranteed placeholder-free. Narrow the placeholder-bearing
// fields back to their concrete shapes here so hosts get a real `boolean`/array
// and the compiler stops them mishandling a would-be placeholder string. The
// authoring-preview path (SkeletonPlaceholder) keeps the widened `DiscussionType`.
export type ResolvedDiscussionType = Omit<
  DiscussionType,
  "showNickname" | "showTitle" | "rooms" | "layout"
> & {
  showNickname: boolean;
  showTitle: boolean;
  rooms?: DiscussionRoomType[];
  layout?: Record<
    string,
    Omit<LayoutDefinitionType, "feeds"> & { feeds: LayoutFeedType[] }
  >;
};

// Compile-time guards (#567): fail the dts build if any placeholder-bearing
// slot re-widens on the resolved type — the point of the split is that the
// runtime seam sees real booleans/arrays, never a `${…}` string. Booleans are
// the load-bearing case (a `boolean | string` re-widening silently inverts
// `if (showTitle)`), but we also pin `rooms` and the fragile nested
// `layout[].feeds` mapped type (a `LayoutDefinitionType` refactor could
// otherwise re-widen it unnoticed). Zero runtime footprint.
type AssertTrue<T extends true> = T;
type IsExactlyBoolean<T> = [T] extends [boolean]
  ? [boolean] extends [T]
    ? true
    : false
  : false;
type HasNoStringMember<T> = [Extract<T, string>] extends [never] ? true : false;
type AllTrue<T extends readonly boolean[]> = T[number] extends true
  ? true
  : false;
/* eslint-disable @typescript-eslint/no-unused-vars */
type _ResolvedDiscussionNarrowed = AssertTrue<
  AllTrue<
    [
      IsExactlyBoolean<ResolvedDiscussionType["showTitle"]>,
      IsExactlyBoolean<ResolvedDiscussionType["showNickname"]>,
      HasNoStringMember<ResolvedDiscussionType["rooms"]>,
      HasNoStringMember<
        NonNullable<ResolvedDiscussionType["layout"]>[string]["feeds"]
      >,
    ]
  >
>;
/* eslint-enable @typescript-eslint/no-unused-vars */

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
  // Post-fill the declared pairing (#499) must be a concrete array of
  // sequence names. Placeholder LEAKS (whole-field string or per-item
  // entry still carrying `${...}`) are tagged `unresolved-placeholder`
  // (filtered in authoring contexts via `skipUnresolved`, hard errors in
  // production hosts); a plain non-placeholder string is a SHAPE error
  // (`compatibleIntroSequences: onboarding` instead of `[onboarding]`) and stays a
  // hard error everywhere — misdiagnosing it as a binding problem would
  // let authoring contexts silently swallow it. The per-item check is
  // explicit because nameSchema deliberately ACCEPTS `${field}`
  // placeholders (legal pre-fill).
  compatibleIntroSequences: z
    .array(
      nameSchema.superRefine((name, ctx) => {
        if (name.includes("${")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `compatibleIntroSequences entry is an unresolved \`${name}\` placeholder. The template field was not bound during fillTemplates — check the broadcast row or additionalFields.`,
            params: { reason: "unresolved-placeholder" },
          });
        }
      }),
    )
    .or(
      z.string().superRefine((value, ctx) => {
        if (value.includes("${")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `compatibleIntroSequences is an unresolved \`${value}\` placeholder. The template field was not bound during fillTemplates — check the broadcast row or additionalFields.`,
            params: { reason: "unresolved-placeholder" },
          });
        } else {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `compatibleIntroSequences must be an array of intro-sequence names; got the string "${value}". Did you mean \`compatibleIntroSequences: [${value}]\`?`,
          });
        }
      }),
    ),
  // Post-fill the locale is a concrete BCP-47 tag — no `${field}` placeholder
  // (a leaked placeholder fails the syntactic check, surfacing an unbound
  // locale). Optional; absent means English.
  locale: localeSchema.optional(),
  groupComposition: z
    .array(
      z
        .object({
          position: positionSchema,
          title: z.string().max(25).optional(),
          conditions: resolvedConditionsSchema,
        })
        .superRefine((data, ctx) => {
          // Same `self`-only rule as the pre-fill `playerSchema` (#526).
          // Unlike the cross-treatment checks this schema deliberately
          // omits, this is a fillTemplates leak the resolved schema exists
          // to catch: when `groupComposition` is a `${field}` placeholder,
          // the pre-fill schema skips it entirely, so a host-supplied
          // composition with a cross-participant selector (`shared`, a slot
          // index, or `all`) is first seen post-fill — enforce it here too
          // or it slips through on the resolved/preview path.
          validateConditionRules(data.conditions, ["conditions"], ctx, {
            contextLabel: "Group-composition",
            forbidSelfPosition: false,
            requireSelfPosition: true,
          });
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

// Consent arm (#481) — post-fill: concrete name, concrete locale (a
// leaked `${...}` fails the syntactic check, like intro sequences).
const resolvedConsentArmSchema = z.object({
  // Post-fill the arm name must be CONCRETE: the host selects arms by
  // name, so a leaked `${...}` (nameSchema accepts placeholders — they're
  // legal pre-fill) would leave the missing binding invisible until
  // host selection fails. Tagged like the other leak checks so authoring
  // contexts can filter it via skipUnresolved.
  name: nameSchema.superRefine((name, ctx) => {
    if (name.includes("${")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Consent arm name is an unresolved \`${name}\` placeholder. The template field was not bound during fillTemplates — check the invocation's fields or broadcast row.`,
        params: { reason: "unresolved-placeholder" },
      });
    }
  }),
  locale: localeSchema.optional(),
  steps: z.array(resolvedIntroExitStepSchema).nonempty(),
});

const resolvedIntroSequenceSchema = z.object({
  name: nameSchema,
  // Post-fill: a concrete BCP-47 tag (a leaked `${field}` placeholder fails
  // the syntactic check). Optional; absent means English.
  locale: localeSchema.optional(),
  introSteps: z.array(resolvedIntroExitStepSchema).nonempty(),
});

const resolvedTreatmentFileBaseSchema = z.object({
  imports: z.array(z.string().min(1)).optional(),
  // `templates:` is stripped by `fillTemplates` so it's not in the
  // post-fill shape. Keep the field permissively typed in case a
  // caller passes a not-yet-stripped tree.
  templates: z.array(z.unknown()).optional(),
  introSequences: z.array(resolvedIntroSequenceSchema).optional(),
  treatments: z.array(resolvedTreatmentSchema).optional(),
  consent: z.array(resolvedConsentArmSchema).optional(),
});

// Consent-arm uniqueness re-checked POST-fill (#481): the pre-fill check
// (treatment.ts) rightly skips `${...}` placeholder names, so a
// single-source consentArm template invoked twice with the same fields
// produces duplicate arm names that only exist after expansion. Those
// land in the diff orchestrator's hydratedOnly bucket, which the editor
// deliberately doesn't surface — the resolved pass is what turns them
// into errors. Host selects arms BY NAME, so a duplicate is a real
// break, not a lint. The message deliberately carries NO arm index and
// matches the pre-fill check's text byte-for-byte: template expansion
// shifts indices between the source and hydrated passes, and the diff
// orchestrator matches issues on exact normalized text — an embedded
// index would unpair the same literal duplicate across passes (#499
// advisory-suffix bug class).
export const resolvedTreatmentFileSchema =
  resolvedTreatmentFileBaseSchema.superRefine((data, ctx) => {
    if (!Array.isArray(data.consent)) return;
    const seen = new Set<string>();
    data.consent.forEach((arm, armIdx) => {
      const name = arm?.name;
      if (typeof name !== "string") return;
      if (!seen.has(name)) {
        seen.add(name);
        return;
      }
      // Truncate + control-strip like the pre-fill check: this superRefine
      // also runs on dirty parses, so a name that fails nameSchema still
      // reaches the interpolation. The stable prefix is what the diff
      // layer's dedupe keys on, and both layers render identical text for
      // schema-valid names.
      const displayName = (
        name.length > 80 ? `${name.slice(0, 77)}…` : name
      ).replace(/\p{Cc}/gu, " ");
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consent", armIdx, "name"],
        message: `Consent arm name "${displayName}" is already used by an earlier consent arm. Arm names must be unique within \`consent:\` — the host selects an arm by name.`,
      });
    });
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
   * runner) leave this off so unbound fields surface as
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
  let issues: ValidateResolvedIssue[] = result.success
    ? []
    : result.error.issues.map((issue) => {
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

  // #568 — global placeholder-leak sweep over the raw filled tree. Catches
  // surviving `${…}` in string-typed slots the resolved schema accepts as
  // valid strings (condition value, buttonText, url, …). Runs even when the
  // schema otherwise passes — that's exactly the silent-leak case. Deduped
  // by path against the per-field guards above (which carry more specific
  // messages) so a single leak isn't reported twice; a leak the schema
  // already errored on for another reason (e.g. a numeric slot's "Expected
  // number") is likewise not double-reported.
  const leaks: { path: (string | number)[]; token: string }[] = [];
  collectPlaceholderLeaks(filled, [], leaks);
  const seenPaths = new Set(issues.map((i) => JSON.stringify(i.path)));
  for (const leak of leaks) {
    const key = JSON.stringify(leak.path);
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    issues.push({
      path: leak.path,
      message: `${leak.path.join(".") || "value"} is an unresolved \`${leak.token}\` placeholder. The template field was not bound during fillTemplates — check the broadcast row, additionalFields, or annotator binding.`,
      reason: "unresolved-placeholder",
    });
  }

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
