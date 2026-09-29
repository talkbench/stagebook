import type { MetadataType } from "../schemas/promptFile.js";
import { checkResponse } from "./checkResponse.js";
import type { DebugMessage } from "./promptTelemetry.js";

export interface BuildPromptRecordOptions {
  metadata: MetadataType;
  /** Resolved storage name; takes precedence over the frontmatter name. */
  name: string;
  file?: string;
  shared?: boolean;
  body: string;
  /** Displayed response options or placeholder lines, in their displayed order. */
  responses: readonly string[];
  value: unknown;
  label?: string;
  debugMessages?: readonly DebugMessage[];
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
  value: unknown;
  label?: string;
  debugMessages: DebugMessage[];
  isValid?: boolean;
  step?: string;
  stageTimeElapsed?: number;
};

/**
 * Build the same record for a control commit and a host's final snapshot.
 * This is pure: it performs no I/O and has no React dependency. Player
 * responses carry advisory validity; shared responses have neither validity
 * nor participant typing telemetry (#668, #697).
 */
export function buildPromptRecord({
  metadata,
  name,
  file,
  shared = false,
  body,
  responses,
  value,
  label,
  debugMessages = [],
  step,
  stageTimeElapsed,
}: BuildPromptRecordOptions): PromptRecord {
  return {
    ...metadata,
    name,
    file,
    shared,
    prompt: body,
    responses: [...responses],
    debugMessages: shared ? [] : [...debugMessages],
    value,
    ...(!shared
      ? {
          isValid: checkResponse(value, {
            required: "required" in metadata && metadata.required === true,
            minLength:
              metadata.type === "openResponse" ? metadata.minLength : undefined,
            maxLength:
              metadata.type === "openResponse" ? metadata.maxLength : undefined,
          }).isValid,
        }
      : {}),
    ...(label !== undefined ? { label } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(stageTimeElapsed !== undefined ? { stageTimeElapsed } : {}),
  };
}
