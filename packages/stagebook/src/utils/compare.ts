export type Comparator =
  | "exists"
  | "doesNotExist"
  | "equals"
  | "doesNotEqual"
  | "isAbove"
  | "isBelow"
  | "isAtLeast"
  | "isAtMost"
  | "hasLengthAtLeast"
  | "hasLengthAtMost"
  | "includes"
  | "doesNotInclude"
  | "matches"
  | "doesNotMatch"
  | "isOneOf"
  | "isNotOneOf";

function trimSlashes(str: string): string {
  return str
    .split("/")
    .filter((v) => v !== "")
    .join("/");
}

function isNumberOrParsableNumber(value: unknown): boolean {
  return (
    typeof value === "number" ||
    (typeof value === "string" &&
      value.trim() !== "" &&
      !Number.isNaN(Number(value)))
  );
}

export function compare(
  lhs: unknown,
  comparator: Comparator,
  rhs?: unknown,
): boolean | undefined {
  switch (comparator) {
    case "exists":
      return lhs !== undefined;
    case "doesNotExist":
      return lhs === undefined;
  }

  if (lhs === undefined) {
    // When lhs is undefined (e.g. player hasn't typed anything yet),
    // most comparators can't decide — return undefined and let Kleene
    // logic propagate the "data not yet" state through the condition
    // tree. The four "negative" comparators are an exception: by the
    // author's mental model, an absent value satisfies "does not
    // equal X" / "does not include X" / etc. (it's not X — it's
    // nothing). This lets authors gate a fallback prompt on
    // `doesNotEqual "Yes"` and have it render before the participant
    // has answered (#348). The asymmetry with their positive twins
    // (`equals`, `includes`, …) is intentional — authors mostly want
    // positive gates to wait for definite data, negative gates to
    // fire on absence.
    switch (comparator) {
      case "doesNotEqual":
      case "doesNotInclude":
      case "doesNotMatch":
      case "isNotOneOf":
        return true;
    }
    return undefined;
  }

  if (isNumberOrParsableNumber(lhs) && isNumberOrParsableNumber(rhs)) {
    const numLhs = parseFloat(lhs as string);
    const numRhs = parseFloat(rhs as string);
    switch (comparator) {
      case "equals":
        return numLhs === numRhs;
      case "doesNotEqual":
        return numLhs !== numRhs;
      case "isAbove":
        return numLhs > numRhs;
      case "isBelow":
        return numLhs < numRhs;
      case "isAtLeast":
        return numLhs >= numRhs;
      case "isAtMost":
        return numLhs <= numRhs;
    }
  }

  if (typeof lhs === "string" && !Number.isNaN(rhs)) {
    switch (comparator) {
      case "hasLengthAtLeast":
        return lhs.length >= parseFloat(rhs as string);
      case "hasLengthAtMost":
        return lhs.length <= parseFloat(rhs as string);
    }
  }

  if (typeof lhs === "string" && typeof rhs === "string") {
    switch (comparator) {
      case "equals":
        return lhs === rhs;
      case "doesNotEqual":
        return lhs !== rhs;
      case "includes":
        return lhs.includes(rhs);
      case "doesNotInclude":
        return !lhs.includes(rhs);
      case "matches":
        return !!lhs.match(new RegExp(trimSlashes(rhs)));
      case "doesNotMatch":
        return !lhs.match(new RegExp(trimSlashes(rhs)));
    }
  }

  if (typeof lhs === "boolean" && typeof rhs === "boolean") {
    switch (comparator) {
      case "equals":
        return lhs === rhs;
      case "doesNotEqual":
        return lhs !== rhs;
    }
  }

  if (Array.isArray(rhs)) {
    switch (comparator) {
      case "isOneOf":
        return rhs.includes(lhs);
      case "isNotOneOf":
        return !rhs.includes(lhs);
    }
  }

  return undefined;
}
