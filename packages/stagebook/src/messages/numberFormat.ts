import type { NumberFormat } from "./types.js";

/** Validate a complete pair from a catalog or persisted record. */
export function isNumberFormat(value: unknown): value is NumberFormat {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const { decimal, grouping } = value as Record<string, unknown>;
  const isSeparator = (separator: unknown): separator is string =>
    typeof separator === "string" &&
    separator.length === 1 &&
    separator !== "-" &&
    !/\p{N}/u.test(separator);
  return (
    isSeparator(decimal) &&
    isSeparator(grouping) &&
    decimal !== grouping &&
    decimal.trim().length > 0 &&
    (grouping.trim().length > 0 || [" ", "\u00a0", "\u202f"].includes(grouping))
  );
}
