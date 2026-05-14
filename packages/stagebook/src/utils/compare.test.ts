import { describe, test, expect } from "vitest";
import { compare } from "./compare.js";

// ----------- Existence checks ------------

describe("exists / doesNotExist", () => {
  test("exists returns true for defined value", () => {
    expect(compare("hello", "exists")).toBe(true);
  });

  test("exists returns false for undefined", () => {
    expect(compare(undefined, "exists")).toBe(false);
  });

  test("doesNotExist returns true for undefined", () => {
    expect(compare(undefined, "doesNotExist")).toBe(true);
  });

  test("doesNotExist returns false for defined value", () => {
    expect(compare("hello", "doesNotExist")).toBe(false);
  });
});

// ----------- Undefined LHS behavior ------------

describe("undefined lhs", () => {
  // Per #348: the four "negative" comparators are satisfied by
  // absence — author's mental model is "the value is not X, because
  // it's nothing". Positive comparators remain undefined so authors
  // can gate fallbacks without prematurely satisfying positive
  // checks. The asymmetry with positive twins is intentional.
  test("doesNotEqual returns true when lhs is undefined", () => {
    expect(compare(undefined, "doesNotEqual", "anything")).toBe(true);
  });

  test("doesNotInclude returns true when lhs is undefined (#348)", () => {
    expect(compare(undefined, "doesNotInclude", "x")).toBe(true);
  });

  test("doesNotMatch returns true when lhs is undefined (#348)", () => {
    expect(compare(undefined, "doesNotMatch", "/x/")).toBe(true);
  });

  test("isNotOneOf returns true when lhs is undefined (#348)", () => {
    expect(compare(undefined, "isNotOneOf", ["a", "b"])).toBe(true);
  });

  test("equals returns undefined when lhs is undefined", () => {
    expect(compare(undefined, "equals", "anything")).toBeUndefined();
  });

  test("includes returns undefined when lhs is undefined", () => {
    expect(compare(undefined, "includes", "x")).toBeUndefined();
  });

  test("matches returns undefined when lhs is undefined", () => {
    expect(compare(undefined, "matches", "/x/")).toBeUndefined();
  });

  test("isOneOf returns undefined when lhs is undefined", () => {
    expect(compare(undefined, "isOneOf", ["a", "b"])).toBeUndefined();
  });

  test("isAbove returns undefined when lhs is undefined", () => {
    expect(compare(undefined, "isAbove", 5)).toBeUndefined();
  });

  test("isAtLeast returns undefined when lhs is undefined", () => {
    expect(compare(undefined, "isAtLeast", 0)).toBeUndefined();
  });
});

// ----------- Numeric comparisons ------------

describe("numeric comparisons", () => {
  test("equals with numbers", () => {
    expect(compare(5, "equals", 5)).toBe(true);
    expect(compare(5, "equals", 6)).toBe(false);
  });

  test("doesNotEqual with numbers", () => {
    expect(compare(5, "doesNotEqual", 6)).toBe(true);
    expect(compare(5, "doesNotEqual", 5)).toBe(false);
  });

  test("isAbove", () => {
    expect(compare(5, "isAbove", 3)).toBe(true);
    expect(compare(3, "isAbove", 5)).toBe(false);
    expect(compare(5, "isAbove", 5)).toBe(false);
  });

  test("isBelow", () => {
    expect(compare(3, "isBelow", 5)).toBe(true);
    expect(compare(5, "isBelow", 3)).toBe(false);
  });

  test("isAtLeast", () => {
    expect(compare(5, "isAtLeast", 5)).toBe(true);
    expect(compare(5, "isAtLeast", 3)).toBe(true);
    expect(compare(3, "isAtLeast", 5)).toBe(false);
  });

  test("isAtMost", () => {
    expect(compare(5, "isAtMost", 5)).toBe(true);
    expect(compare(3, "isAtMost", 5)).toBe(true);
    expect(compare(5, "isAtMost", 3)).toBe(false);
  });

  test("parseable string numbers are compared numerically", () => {
    expect(compare("5", "equals", 5)).toBe(true);
    expect(compare("5", "isAbove", "3")).toBe(true);
    expect(compare("10", "isBelow", "9")).toBe(false);
  });
});

// ----------- String length comparisons ------------

describe("string length comparisons", () => {
  test("hasLengthAtLeast", () => {
    expect(compare("hello", "hasLengthAtLeast", 5)).toBe(true);
    expect(compare("hi", "hasLengthAtLeast", 5)).toBe(false);
  });

  test("hasLengthAtMost", () => {
    expect(compare("hi", "hasLengthAtMost", 5)).toBe(true);
    expect(compare("hello world", "hasLengthAtMost", 5)).toBe(false);
  });
});

// ----------- String comparisons ------------

describe("string comparisons", () => {
  test("equals with strings", () => {
    expect(compare("hello", "equals", "hello")).toBe(true);
    expect(compare("hello", "equals", "world")).toBe(false);
  });

  test("doesNotEqual with strings", () => {
    expect(compare("hello", "doesNotEqual", "world")).toBe(true);
    expect(compare("hello", "doesNotEqual", "hello")).toBe(false);
  });

  test("includes", () => {
    expect(compare("hello world", "includes", "world")).toBe(true);
    expect(compare("hello", "includes", "xyz")).toBe(false);
  });

  test("doesNotInclude", () => {
    expect(compare("hello", "doesNotInclude", "xyz")).toBe(true);
    expect(compare("hello world", "doesNotInclude", "world")).toBe(false);
  });

  test("matches with regex", () => {
    expect(compare("hello123", "matches", "\\d+")).toBe(true);
    expect(compare("hello", "matches", "\\d+")).toBe(false);
  });

  test("doesNotMatch with regex", () => {
    expect(compare("hello", "doesNotMatch", "\\d+")).toBe(true);
    expect(compare("hello123", "doesNotMatch", "\\d+")).toBe(false);
  });

  test("matches strips leading/trailing slashes from regex", () => {
    expect(compare("hello123", "matches", "/\\d+/")).toBe(true);
  });
});

// ----------- Boolean comparisons ------------

describe("boolean comparisons", () => {
  test("equals with booleans", () => {
    expect(compare(true, "equals", true)).toBe(true);
    expect(compare(true, "equals", false)).toBe(false);
  });

  test("doesNotEqual with booleans", () => {
    expect(compare(true, "doesNotEqual", false)).toBe(true);
    expect(compare(true, "doesNotEqual", true)).toBe(false);
  });
});

// ----------- Array comparisons (isOneOf / isNotOneOf) ------------

describe("array comparisons", () => {
  test("isOneOf", () => {
    expect(compare("a", "isOneOf", ["a", "b", "c"])).toBe(true);
    expect(compare("d", "isOneOf", ["a", "b", "c"])).toBe(false);
  });

  test("isNotOneOf", () => {
    expect(compare("d", "isNotOneOf", ["a", "b", "c"])).toBe(true);
    expect(compare("a", "isNotOneOf", ["a", "b", "c"])).toBe(false);
  });

  test("isOneOf with numbers", () => {
    expect(compare(1, "isOneOf", [1, 2, 3])).toBe(true);
    expect(compare(4, "isOneOf", [1, 2, 3])).toBe(false);
  });
});

// ----------- Invalid comparator ------------

describe("invalid comparator", () => {
  test("returns undefined for unknown comparator", () => {
    expect(compare("a", "bogus" as never, "b")).toBeUndefined();
  });
});
