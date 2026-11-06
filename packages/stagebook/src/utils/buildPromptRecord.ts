import type { MetadataType } from "../schemas/promptFile.js";
import type { NumberFormat } from "../messages/types.js";
import { checkResponse } from "./checkResponse.js";
import { parseNumericEntry } from "./numericResponse.js";
import type { DebugMessage, FieldTiming } from "./promptTelemetry.js";
import type { PointerStats } from "./pointerTelemetry.js";

export interface BuildPromptRecordOptions {
  metadata: MetadataType;
  /** Resolved storage name; takes precedence over the frontmatter name. */
  name: string;
  file?: string;
  shared?: boolean;
  body: string;
  /** Displayed response options or placeholder lines, in their displayed order. */
  responses: readonly string[];
  /** Nonnumeric value. Numeric records always derive their value from entry. */
  value?: unknown;
  /** Numeric records require raw entry and the effective parsing format. */
  entry?: string;
  numberFormat?: NumberFormat;
  label?: string;
  debugMessages?: readonly DebugMessage[];
  /** Bounded cumulative pointer/focus snapshot, when the control supplies one. */
  pointerStats?: PointerStats;
  /** Mount-to-first-focus timing for solo text and numeric fields. */
  fieldTiming?: FieldTiming;
  /** Commit-time context supplied by the caller; the builder reads no clocks. */
  step?: string;
  stageTimeElapsed?: number;
}

export type PromptRecord = MetadataType & {
  name: string;
  file?: string;
  shared: boolean;
  prompt: string;
  responses: string[];
  value?: unknown;
  entry?: string;
  numberFormat?: NumberFormat;
  label?: string;
  debugMessages: DebugMessage[];
  pointerStats?: PointerStats;
  fieldTiming?: FieldTiming;
  isValid?: boolean;
  step?: string;
  stageTimeElapsed?: number;
};

/**
 * Build the same record for a control commit and a host's final snapshot.
 * This is pure: it performs no I/O and has no React dependency. Player
 * responses carry advisory validity. Shared numeric responses also carry group
 * validity; other shared responses omit it. All shared responses omit participant
 * interaction telemetry (#668, #697, #687, #827, #831).
 */
export function buildPromptRecord({
  metadata,
  name,
  file,
  shared = false,
  body,
  responses,
  value,
  entry,
  numberFormat,
  label,
  debugMessages = [],
  pointerStats,
  fieldTiming,
  step,
  stageTimeElapsed,
}: BuildPromptRecordOptions): PromptRecord {
  let response: Pick<
    PromptRecord,
    "value" | "entry" | "numberFormat" | "isValid"
  >;
  if (metadata.type === "numericResponse") {
    if (typeof entry !== "string" || numberFormat === undefined) {
      throw new TypeError(
        "Numeric prompt records require entry and numberFormat",
      );
    }
    const parsed = parseNumericEntry(entry, numberFormat);
    response = {
      // Anything over 100 is already tooLong. Keeping up to 1,000 characters
      // preserves that verdict while bounding persisted remote/untrusted text.
      entry: entry.slice(0, 1000),
      numberFormat: { ...numberFormat },
      ...(parsed.status === "parsed" ? { value: parsed.value } : {}),
      isValid: checkResponse(entry, {
        type: "numericResponse",
        numberFormat,
        required: metadata.required,
        min: metadata.min,
        max: metadata.max,
        integer: metadata.integer,
      }).isValid,
    };
  } else {
    response = {
      value,
      ...(!shared
        ? {
            isValid: checkResponse(value, {
              required: "required" in metadata && metadata.required === true,
              minLength:
                metadata.type === "openResponse"
                  ? metadata.minLength
                  : undefined,
              maxLength:
                metadata.type === "openResponse"
                  ? metadata.maxLength
                  : undefined,
            }).isValid,
          }
        : {}),
    };
  }
  const record: PromptRecord = {
    ...metadata,
    name,
    file,
    shared,
    prompt: body,
    responses: [...responses],
    debugMessages: shared ? [] : [...debugMessages],
    ...(!shared && pointerStats
      ? { pointerStats: structuredClone(pointerStats) }
      : {}),
    ...response,
    ...(label !== undefined ? { label } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(stageTimeElapsed !== undefined ? { stageTimeElapsed } : {}),
  };
  // Runtime telemetry must come from the caller, never authored metadata.
  delete record.fieldTiming;
  if (
    !shared &&
    (metadata.type === "openResponse" || metadata.type === "numericResponse") &&
    fieldTiming !== undefined
  ) {
    record.fieldTiming = { ...fieldTiming };
  }
  return record;
}
