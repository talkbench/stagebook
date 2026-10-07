/** Saved-record contracts for host CI (#690, #751), never runtime gates. */
import { z } from "zod";
import { attributesSchema } from "./attributes.js";

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
  })
  .passthrough();

export const timelinePointSchema = z
  .object({
    time: finiteNumber,
    track: finiteNumber.optional(),
  })
  .passthrough();

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

/** Only these sources have a complete record contract in this helper. */
export const hostRecordSchemas = Object.freeze({
  attributes: attributesSchema,
  timeline: timelineRecordSchema,
  trackedLink: trackedLinkRecordSchema,
  submitButton: submitButtonRecordSchema,
});
export type HostRecordSource = keyof typeof hostRecordSchemas;
export type HostRecord = z.infer<(typeof hostRecordSchemas)[HostRecordSource]>;

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
): z.ZodSafeParseResult<HostRecord> {
  if (!Object.prototype.hasOwnProperty.call(hostRecordSchemas, source)) {
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
  return hostRecordSchemas[source as HostRecordSource].safeParse(record);
}
