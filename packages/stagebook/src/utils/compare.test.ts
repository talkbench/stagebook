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
  // Missing satisfies no positive comparison; the exact negative is true.
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

  test("equals returns false when lhs is undefined", () => {
    expect(compare(undefined, "equals", "anything")).toBe(false);
  });

  test("includes returns false when lhs is undefined", () => {
    expect(compare(undefined, "includes", "x")).toBe(false);
  });

  test("matches returns false when lhs is undefined", () => {
    expect(compare(undefined, "matches", "/x/")).toBe(false);
  });

  test("isOneOf returns false when lhs is undefined", () => {
    expect(compare(undefined, "isOneOf", ["a", "b"])).toBe(false);
  });

  test("isAbove returns false when lhs is undefined", () => {
    expect(compare(undefined, "isAbove", 5)).toBe(false);
  });

  test("isAtLeast returns false when lhs is undefined", () => {
    expect(compare(undefined, "isAtLeast", 0)).toBe(false);
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

  test("numeric-looking strings are not coerced to numbers", () => {
    expect(compare("5", "equals", 5)).toBe(false);
    expect(compare("5", "isAbove", "3")).toBe(false);
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

// ----------- Multi-select (array LHS) membership ------------
//
// A `select: multiple` checkbox prompt saves its value as a string[]
// (the selected option labels). When that lands on the LHS of a
// condition, `includes`/`doesNotInclude` do element membership and the
// length comparators measure how many options were checked. The
// condition `value` stays a scalar label — no schema change. (#470)

describe("multi-select (array LHS) membership", () => {
  test("includes is element membership, not substring", () => {
    expect(compare(["Likert scales", "Sliders"], "includes", "Sliders")).toBe(
      true,
    );
    expect(compare(["Likert scales", "Sliders"], "includes", "Drag")).toBe(
      false,
    );
    // Substring of a member must NOT match — membership is exact.
    expect(compare(["Sliders"], "includes", "Slide")).toBe(false);
  });

  test("includes on an empty selection is false", () => {
    expect(compare([], "includes", "Sliders")).toBe(false);
  });

  test("doesNotInclude is the symmetric negation on arrays", () => {
    expect(compare(["Likert scales"], "doesNotInclude", "Sliders")).toBe(true);
    expect(compare(["Likert scales"], "doesNotInclude", "Likert scales")).toBe(
      false,
    );
    // Emptied selection includes nothing, so it does-not-include anything.
    expect(compare([], "doesNotInclude", "Sliders")).toBe(true);
  });

  test("hasLengthAtLeast counts selected options", () => {
    expect(compare(["a", "b"], "hasLengthAtLeast", 2)).toBe(true);
    expect(compare(["a"], "hasLengthAtLeast", 2)).toBe(false);
    expect(compare([], "hasLengthAtLeast", 1)).toBe(false);
  });

  test("hasLengthAtMost counts selected options", () => {
    expect(compare(["a"], "hasLengthAtMost", 2)).toBe(true);
    expect(compare(["a", "b", "c"], "hasLengthAtMost", 2)).toBe(false);
    expect(compare([], "hasLengthAtMost", 0)).toBe(true);
  });

  test("numeric labels compare as strings (no coercion)", () => {
    // Multi-select labels are always strings; membership is strict.
    expect(compare(["5", "7"], "includes", "5")).toBe(true);
    expect(compare(["5", "7"], "includes", 5)).toBe(false);
  });

  test("scalar comparators treat an array as Missing before negation", () => {
    // No accidental array-vs-array equality or numeric coercion: these
    // reject the positive claim; exact negations remain true.
    expect(compare(["a"], "equals", "a")).toBe(false);
    expect(compare(["a"], "doesNotEqual", "a")).toBe(true);
    expect(compare(["1"], "isAbove", 0)).toBe(false);
    expect(compare(["a"], "isOneOf", ["a", "b"])).toBe(false);
    expect(compare(["a"], "matches", "a")).toBe(false);
  });

  test("exists/doesNotExist still answer presence for arrays", () => {
    // Handled by the top-of-function presence probe — an emptied
    // selection is still a value that exists.
    expect(compare([], "exists")).toBe(true);
    expect(compare(["a"], "exists")).toBe(true);
    expect(compare([], "doesNotExist")).toBe(false);
  });
});

// ----------- Invalid comparator ------------

describe("invalid comparator", () => {
  test("returns false for unknown comparator", () => {
    expect(compare("a", "bogus" as never, "b")).toBe(false);
  });
});

// These are the absence semantics behind the two isValid idioms in #668.
// Keep absence explicit so the optional idiom survives #299's tri-state rules.
describe("prompt validity condition idioms (#668)", () => {
  test("doesNotExist permits an untouched prompt with absent isValid", () => {
    expect(compare(undefined, "doesNotExist")).toBe(true);
  });
  test("equals true never permits an untouched prompt with absent isValid", () => {
    expect(compare(undefined, "equals", true)).toBe(false);
  });
});
