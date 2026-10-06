import { Missing } from "./missing.js";

/** Execution caps reduce work; native backtracking regexes still have no hard
 * time bound. See docs/engineer/regex-execution.md and the isolated benchmark. */
export const MAX_REGEX_INPUT_LENGTH = 4_096;
export const MAX_REGEX_PATTERN_LENGTH = 1_024;

/** Compile only. Validation must never run author patterns on any text. */
export function validateRegex(
  pattern: string,
  flags: string,
): string | undefined {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return `Regex pattern length must not exceed ${MAX_REGEX_PATTERN_LENGTH} UTF-16 code units.`;
  }
  if (!/^[isu]*$/.test(flags) || new Set(flags).size !== flags.length) {
    return "Regex flags may contain only i, s, and u, without duplicates.";
  }
  try {
    new RegExp(pattern, flags);
    return undefined;
  } catch {
    return "Invalid JavaScript regular expression.";
  }
}

/** Leaf shorthand supports /pattern/flags; operator patterns are raw strings. */
export function parseRegexLiteral(
  value: string,
): { pattern: string; flags: string } | undefined {
  if (!value.startsWith("/")) return { pattern: value, flags: "" };
  const delimiter = value.lastIndexOf("/");
  if (delimiter === 0) return undefined;
  return {
    pattern: value.slice(1, delimiter),
    flags: value.slice(delimiter + 1),
  };
}

/** All patterns must match. Oversized input makes no positive match; it is
 * never truncated into a different answer. Invalid runtime syntax is Missing. */
export function matchPatterns(
  input: string | Missing,
  patterns: unknown,
  flags: unknown,
): boolean | Missing {
  if (
    !Array.isArray(patterns) ||
    patterns.length === 0 ||
    patterns.length > 10_000 ||
    typeof flags !== "string"
  )
    return Missing;
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    if (
      typeof pattern !== "string" ||
      validateRegex(pattern, flags) !== undefined
    )
      return Missing;
    compiled.push(new RegExp(pattern, flags));
  }
  if (input === Missing || input.length > MAX_REGEX_INPUT_LENGTH) return false;
  return compiled.every((pattern) => pattern.test(input));
}
