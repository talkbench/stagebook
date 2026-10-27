/** Saved-record contracts for host CI (#690, #751), never runtime gates. */
import { z } from "zod";
import { attributesSchema } from "./attributes.js";
import { mediaPlayerRecordSchema } from "./mediaPlayerRecord.js";

const finiteNumber = z.number().finite();

// Element adds these fields to object records. Standalone components do not
// need to, and Timeline saves a bare array that Element leaves unwrapped.
const elementMetadata = {
  step: z.string().optional(),
  stageTimeElapsed: finiteNumber.optional(),
};

export const timelineRangeSchema = z
  .object({
    start: finiteNumber,
    end: finiteNumber,
    track: finiteNumber.optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .refine(
    (s) => s.track === undefined || s.position === undefined,
    "A selection cannot contain both track and position.",
  );

export const timelinePointSchema = z
  .object({
    time: finiteNumber,
    track: finiteNumber.optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .refine(
    (s) => s.track === undefined || s.position === undefined,
    "A selection cannot contain both track and position.",
  );

/** One selection mode per timeline; an empty array is a saved empty answer. */
export const timelineRecordSchema = z.union([
  z.array(timelineRangeSchema),
  z.array(timelinePointSchema),
]);
export type TimelineRecord = z.infer<typeof timelineRecordSchema>;

const trackedLinkEventTypeSchema = z.enum(["click", "blur", "focus"]);

export const trackedLinkEventSchema = z
  .object({
    type: trackedLinkEventTypeSchema,
    timestamp: finiteNumber,
    stage: z.string(),
    stageTimeSeconds: finiteNumber,
    timeAwaySeconds: finiteNumber.optional(),
  })
  .passthrough();
export type TrackedLinkEvent = z.infer<typeof trackedLinkEventSchema>;

export const trackedLinkRecordSchema = z
  .object({
    name: z.string(),
    url: z.string(),
    displayText: z.string(),
    events: z.array(trackedLinkEventSchema),
    totalTimeAwaySeconds: finiteNumber,
    lastEventType: trackedLinkEventTypeSchema.optional(),
    lastTimeAwaySeconds: finiteNumber.optional(),
    lastUpdated: finiteNumber.optional(),
    ...elementMetadata,
  })
  .passthrough();
export type TrackedLinkRecord = z.infer<typeof trackedLinkRecordSchema>;

/** The click-time contract fixed in #750; legacy empty records fail it. */
export const submitButtonRecordSchema = z
  .object({ time: finiteNumber, ...elementMetadata })
  .passthrough();
export type SubmitButtonRecord = z.infer<typeof submitButtonRecordSchema>;

/** Metrics are absent until measured. Hosts must not synthesize a successful
 * discussion or zero speaking time merely because the record was created. */
export const discussionMetricsSchema = z
  .object({
    discussionFailed: z.boolean().optional(),
    cumulativeSpeakingTime: finiteNumber.nonnegative().optional(),
    ...elementMetadata,
  })
  .strict();
export type DiscussionMetrics = z.infer<typeof discussionMetricsSchema>;

/** Only these sources have a complete record contract in this helper. */
export const hostRecordSchemas = Object.freeze({
  attributes: attributesSchema,
  timeline: timelineRecordSchema,
  trackedLink: trackedLinkRecordSchema,
  submitButton: submitButtonRecordSchema,
  discussion: discussionMetricsSchema,
  mediaPlayer: mediaPlayerRecordSchema,
});
export type HostRecordSource = keyof typeof hostRecordSchemas;
export type HostRecord = z.infer<(typeof hostRecordSchemas)[HostRecordSource]>;
export type HostRecordSchemas = Readonly<Record<HostRecordSource, z.ZodType>>;
export interface HostSchemaOptions {
  /** A per-host registry, never global mutable registration. */
  hostSchemas?: HostRecordSchemas;
}

/** Declare additional host fields for validation and host conformance tests.
 * Existing fields cannot be redefined. Runtime reads and stored records are
 * unchanged; callers pass the returned registry to each validation entrypoint. */
export function createHostRecordSchemas(
  fields: { attributes?: z.ZodRawShape; discussion?: z.ZodRawShape } = {},
): HostRecordSchemas {
  for (const source of ["attributes", "discussion"] as const) {
    for (const key of Object.keys(fields[source] ?? {})) {
      if (
        Object.prototype.hasOwnProperty.call(
          hostRecordSchemas[source].shape,
          key,
        ) ||
        ["__proto__", "prototype", "constructor"].includes(key)
      )
        throw new Error(`Cannot redefine reserved ${source} field "${key}".`);
    }
  }
  return Object.freeze({
    ...hostRecordSchemas,
    attributes: attributesSchema.extend(fields.attributes ?? {}),
    discussion: discussionMetricsSchema.extend(fields.discussion ?? {}),
  });
}

/**
 * Check one stored value using its source name (e.g. "timeline", not its
 * "timeline_annotations" storage key). Returns Zod's usual success/data or
 * failure/error result so CI can report error.issues and their field paths.
 * Unsupported sources fail explicitly rather than claiming conformance.
 * This does not coerce, migrate, or mutate the supplied record.
 */
export function checkHostRecord(
  source: string,
  record: unknown,
  options: HostSchemaOptions = {},
): z.ZodSafeParseResult<HostRecord> {
  const schemas = options.hostSchemas ?? hostRecordSchemas;
  if (!Object.prototype.hasOwnProperty.call(schemas, source)) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [],
          message: `Unsupported host record source "${source}". Supported sources: ${Object.keys(hostRecordSchemas).join(", ")}.`,
        },
      ]) as z.ZodError<HostRecord>,
    };
  }
  return schemas[source as HostRecordSource].safeParse(
    record,
  ) as z.ZodSafeParseResult<HostRecord>;
}
