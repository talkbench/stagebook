import type { NumberFormat } from "../messages/types.js";
import {
  parseNumericEntry,
  type NumericConstraints,
} from "./numericResponse.js";

/** Advisory constraints for text and selected responses (#668). */
export interface TextResponseConstraints {
  type?: never;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface NumericResponseConstraints extends NumericConstraints {
  type: "numericResponse";
  numberFormat: NumberFormat;
}

export type ResponseConstraints =
  | TextResponseConstraints
  | NumericResponseConstraints;

export interface ResponseCheck {
  isValid: boolean;
  blank: boolean;
  failed?:
    | "required"
    | "minLength"
    | "maxLength"
    | "unfinished"
    | "malformed"
    | "tooLong"
    | "tooManyDigits"
    | "integer"
    | "min"
    | "max";
}

/**
 * Check a response without changing it or blocking a save. Length constraints
 * apply to nonblank strings and count their untrimmed UTF-16 code units,
 * exactly like the text counter. Optional blank answers skip length checks.
 */
export function checkResponse(
  response: unknown,
  constraints: ResponseConstraints = {},
): ResponseCheck {
  if (constraints.type === "numericResponse") {
    if (typeof response !== "string") {
      return { isValid: false, blank: false, failed: "malformed" };
    }
    const parsed = parseNumericEntry(response, constraints.numberFormat);
    if (parsed.status === "blank") {
      return constraints.required
        ? { isValid: false, blank: true, failed: "required" }
        : { isValid: true, blank: true };
    }
    if (parsed.status !== "parsed") {
      return { isValid: false, blank: false, failed: parsed.status };
    }
    if (constraints.integer && !Number.isInteger(parsed.value)) {
      return { isValid: false, blank: false, failed: "integer" };
    }
    if (constraints.min !== undefined && parsed.value < constraints.min) {
      return { isValid: false, blank: false, failed: "min" };
    }
    if (constraints.max !== undefined && parsed.value > constraints.max) {
      return { isValid: false, blank: false, failed: "max" };
    }
    return { isValid: true, blank: false };
  }
  const blank =
    response === undefined ||
    (Array.isArray(response) && response.length === 0) ||
    (typeof response === "string" && response.trim() === "");
  if (blank) {
    return constraints.required
      ? { isValid: false, blank: true, failed: "required" }
      : { isValid: true, blank: true };
  }
  if (typeof response === "string") {
    if (
      constraints.minLength !== undefined &&
      response.length < constraints.minLength
    ) {
      return { isValid: false, blank: false, failed: "minLength" };
    }
    if (
      constraints.maxLength !== undefined &&
      response.length > constraints.maxLength
    ) {
      return { isValid: false, blank: false, failed: "maxLength" };
    }
  }
  return { isValid: true, blank: false };
}
