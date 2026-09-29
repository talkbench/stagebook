import type { NumberFormat } from "../messages/types.js";

export const NUMERIC_ENTRY_LIMIT = 100;
export const NUMERIC_SIGNIFICANT_DIGITS = 15;

export interface NumericConstraints {
  required?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
}

export type NumericParseResult =
  | { status: "parsed"; value: number }
  | {
      status:
        | "blank"
        | "unfinished"
        | "malformed"
        | "tooLong"
        | "tooManyDigits";
    };

interface NumericPrefix {
  negative: boolean;
  digits: string;
  significantDigits: number;
  hasDecimal: boolean;
  fractionalDigits: number;
}

const isDigit = (character: string): boolean =>
  character >= "0" && character <= "9";

/** Scan the grammar once, including prefixes such as '-' and '5.'. */
function scanPrefix(text: string, format: NumberFormat): NumericPrefix | null {
  const negative = text.startsWith("-");
  let digits = "";
  let significantDigits = 0;
  let hasDecimal = false;
  let fractionalDigits = 0;
  for (let index = negative ? 1 : 0; index < text.length; index++) {
    const character = text[index];
    if (isDigit(character)) {
      digits += character;
      if (character !== "0" || significantDigits > 0) significantDigits++;
      if (hasDecimal) fractionalDigits++;
    } else if (character === format.decimal && !hasDecimal) {
      hasDecimal = true;
    } else {
      return null;
    }
  }
  return { negative, digits, significantDigits, hasDecimal, fractionalDigits };
}

/**
 * Parse raw numeric text without enforcing advisory constraints. The raw cap
 * comes first, including whitespace, so remote or untrusted oversized input
 * never enters the scanner. Separators are literal characters, never regexes.
 */
export function parseNumericEntry(
  entry: string,
  format: NumberFormat,
): NumericParseResult {
  // The public JS/analysis API may receive data outside its TypeScript contract.
  if (typeof entry !== "string") return { status: "malformed" };
  if (entry.length > NUMERIC_ENTRY_LIMIT) return { status: "tooLong" };
  const text = entry.trim();
  if (text === "") return { status: "blank" };
  const prefix = scanPrefix(text, format);
  if (!prefix) return { status: "malformed" };
  if (prefix.significantDigits > NUMERIC_SIGNIFICANT_DIGITS) {
    return { status: "tooManyDigits" };
  }
  if (
    prefix.digits.length === 0 ||
    (prefix.hasDecimal && prefix.fractionalDigits === 0)
  ) {
    return { status: "unfinished" };
  }
  const normalized = text.replace(format.decimal, ".");
  const value = Number(normalized);
  return { status: "parsed", value: value === 0 ? 0 : value };
}

/** Plain, ungrouped decimal spelling, including bounds that JS writes as 1e-7. */
export function formatNumericPlain(
  value: number,
  format: NumberFormat,
): string {
  if (!Number.isFinite(value)) {
    throw new RangeError("Numeric formatting requires a finite number");
  }
  const negative = value < 0;
  const [coefficient, exponentText] = Math.abs(value).toString().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponentText ?? 0);
  let plain: string;
  if (point <= 0) {
    plain = `0${format.decimal}${"0".repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    plain = digits + "0".repeat(point - digits.length);
  } else {
    plain = digits.slice(0, point) + format.decimal + digits.slice(point);
  }
  return (negative ? "-" : "") + plain;
}

// The entry cap bounds all suffix grids. Counts, not candidate strings, select
// these powers. Bound conversion can use a larger exponent for unvalidated
// finite external constraints (JS numbers have at most 324 decimal places).
const powersOfTen = Array.from(
  { length: NUMERIC_ENTRY_LIMIT + 1 },
  (_, exponent) => 10n ** BigInt(exponent),
);
const powerOfTen = (exponent: number): bigint =>
  powersOfTen[exponent] ?? 10n ** BigInt(exponent);

interface DecimalRational {
  numerator: bigint;
  denominator: bigint;
}

function decimalRational(value: number): DecimalRational {
  const plain = formatNumericPlain(value, { decimal: ".", grouping: "," });
  const [whole, fraction = ""] = plain.split(".");
  return {
    numerator: BigInt(whole + fraction),
    denominator: powerOfTen(fraction.length),
  };
}

const ceilDivide = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;

function valueMeetsConstraints(
  value: number,
  limits: NumericConstraints,
): boolean {
  return (
    (!limits.integer || Number.isInteger(value)) &&
    (limits.min === undefined || value >= limits.min) &&
    (limits.max === undefined || value <= limits.max)
  );
}

/**
 * Whether an empty or nonempty suffix can make the actual raw entry valid.
 *
 * Each pair of suffix digit counts describes a closed interval of integer
 * numerators on an exact decimal grid. Intersect it with the inclusive bounds
 * and precision cap; integer mode additionally needs a grid numerator divisible
 * by its denominator. No candidate strings, floating epsilon, or open endpoints.
 * At most 16 integer counts × the remaining character budget are considered;
 * all arithmetic is bounded by the 100-character / 15-significant-digit caps.
 */
export function couldBecomeValidByAppending(
  entry: string,
  constraints: NumericConstraints,
  format: NumberFormat,
): boolean {
  if (typeof entry !== "string" || entry.length > NUMERIC_ENTRY_LIMIT)
    return false;
  if (
    (constraints.min !== undefined && !Number.isFinite(constraints.min)) ||
    (constraints.max !== undefined && !Number.isFinite(constraints.max)) ||
    (constraints.min !== undefined &&
      constraints.max !== undefined &&
      constraints.min > constraints.max)
  )
    return false;
  const parsed = parseNumericEntry(entry, format);
  if (
    parsed.status === "parsed" &&
    valueMeetsConstraints(parsed.value, constraints)
  )
    return true;
  if (parsed.status === "blank" && !constraints.required) return true;
  const text = entry.trim();
  // A whitespace-only prefix can become leading whitespace. Once digits or a
  // sign precede trailing whitespace, further numeric characters cannot help.
  if (text !== "" && entry.trimEnd() !== entry) return false;
  const prefix = scanPrefix(text, format);
  if (!prefix || prefix.significantDigits > NUMERIC_SIGNIFICANT_DIGITS)
    return false;

  // Before any non-whitespace character, either sign is still available.
  const signs = text === "" ? [false, true] : [prefix.negative];
  for (const negative of signs) {
    const extraSign = text === "" && negative ? 1 : 0;
    const remaining = NUMERIC_ENTRY_LIMIT - entry.length - extraSign;
    if (remaining < 0) continue;
    const lower = Math.max(
      0,
      negative ? -(constraints.max ?? Infinity) : (constraints.min ?? 0),
    );
    const upper = negative
      ? constraints.min === undefined
        ? undefined
        : -constraints.min
      : constraints.max;
    if (upper !== undefined && upper < lower) continue;
    const lowerBound = decimalRational(lower);
    const upperBound = upper === undefined ? undefined : decimalRational(upper);
    const prefixNumerator = BigInt(prefix.digits || "0");
    const maxIntegerDigits = prefix.hasDecimal
      ? 0
      : Math.min(NUMERIC_SIGNIFICANT_DIGITS, remaining);

    // More than 15 appended integer digits cannot help: any nonzero part would
    // exceed precision, while appended leading zeroes can be removed instead.
    for (
      let integerDigits = 0;
      integerDigits <= maxIntegerDigits;
      integerDigits++
    ) {
      for (
        let fractionDigits = 0;
        fractionDigits <= remaining - integerDigits;
        fractionDigits++
      ) {
        const newPoint = !prefix.hasDecimal && fractionDigits > 0 ? 1 : 0;
        if (integerDigits + fractionDigits + newPoint > remaining) continue;
        if (prefix.digits.length + integerDigits + fractionDigits === 0)
          continue;
        if (prefix.hasDecimal && prefix.fractionalDigits + fractionDigits === 0)
          continue;
        const appendedDigits = integerDigits + fractionDigits;
        if (
          prefix.significantDigits > 0 &&
          prefix.significantDigits + appendedDigits > NUMERIC_SIGNIFICANT_DIGITS
        )
          continue;

        const suffixScale = powerOfTen(appendedDigits);
        const denominator = powerOfTen(
          prefix.fractionalDigits + fractionDigits,
        );
        let first = prefixNumerator * suffixScale;
        let last = first + suffixScale - 1n;
        if (prefix.significantDigits === 0) {
          const precisionMaximum = powerOfTen(NUMERIC_SIGNIFICANT_DIGITS) - 1n;
          if (last > precisionMaximum) last = precisionMaximum;
        }
        const lowerNumerator = ceilDivide(
          lowerBound.numerator * denominator,
          lowerBound.denominator,
        );
        if (first < lowerNumerator) first = lowerNumerator;
        if (upperBound) {
          const upperNumerator =
            (upperBound.numerator * denominator) / upperBound.denominator;
          if (last > upperNumerator) last = upperNumerator;
        }
        if (first > last) continue;
        if (
          !constraints.integer ||
          ceilDivide(first, denominator) * denominator <= last
        )
          return true;
      }
    }
  }
  return false;
}

export interface NumericInsertion {
  entry: string;
  /** UTF-16 selection offsets, as exposed by a text input. */
  start: number;
  end: number;
  inserted: string;
}

export interface NumericInsertionResult {
  entry: string;
  selectionStart: number;
  selectionEnd: number;
  /** An insertion/deletion was accepted, even if it replaced identical text. */
  accepted: boolean;
  /** Some characters were dropped, or the entire insertion exceeded the cap. */
  refused: boolean;
}

/** Filter local inserted text; remote text and undo must bypass this helper. */
export function filterNumericInsertion(
  { entry, start, end, inserted }: NumericInsertion,
  format: NumberFormat,
): NumericInsertionResult {
  const unchanged = (refused: boolean): NumericInsertionResult => ({
    entry,
    selectionStart: start,
    selectionEnd: end,
    accepted: false,
    refused,
  });
  if (inserted === "") {
    if (start === end) return unchanged(false);
    return {
      entry: entry.slice(0, start) + entry.slice(end),
      selectionStart: start,
      selectionEnd: start,
      accepted: true,
      refused: false,
    };
  }
  if (entry.length > NUMERIC_ENTRY_LIMIT) return unchanged(true);
  let allowed = "";
  for (const character of inserted) {
    if (isDigit(character) || character === "-" || character === format.decimal)
      allowed += character;
  }
  if (allowed === "") return unchanged(true);
  const next = entry.slice(0, start) + allowed + entry.slice(end);
  if (next.length > NUMERIC_ENTRY_LIMIT) return unchanged(true);
  const caret = start + allowed.length;
  return {
    entry: next,
    selectionStart: caret,
    selectionEnd: caret,
    accepted: true,
    refused: allowed !== inserted,
  };
}

/** Omit inputmode unless the iOS numeric keyboard includes every needed key. */
export function numericInputMode(
  constraints: NumericConstraints,
): "numeric" | undefined {
  return constraints.integer &&
    constraints.min !== undefined &&
    constraints.min >= 0
    ? "numeric"
    : undefined;
}
