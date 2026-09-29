/** Advisory constraints declared by a player-scoped prompt. */
export interface ResponseConstraints {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface ResponseCheck {
  isValid: boolean;
  blank: boolean;
  failed?: "required" | "minLength" | "maxLength";
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
