import { describe, expect, test } from "vitest";
import {
  MAX_REGEX_INPUT_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  matchPatterns,
  validateRegex,
} from "./regex.js";
import { evaluateExpression, Missing } from "./evaluateExpression.js";
import { createExpressionSchemas } from "../schemas/expression.js";

describe("specified JavaScript regex contract", () => {
  test.each([
    ["ABC", ["^abc$"], "i", true],
    ["a\nb", ["^a.b$"], "s", true],
    ["🙂", ["^.$"], "u", true],
    ["🙂", ["^.$"], "", false],
    ["AB123", ["^AB", "123$"], "", true],
    ["AB123", ["^AB", "456$"], "", false],
    [" abc ", ["^abc$"], "", false],
    ["aa", ["^(a)\\1$"], "", true],
    ["abc", ["a(?=bc)"], "", true],
  ])(
    "matches raw input %s with %j / %s",
    (input, patterns, flags, expected) => {
      expect(matchPatterns(input, patterns, flags)).toBe(expected);
    },
  );
  test.each(["g", "m", "y", "ii", "iuu"])(
    "rejects unsupported/duplicate flags %s",
    (flags) => {
      expect(validateRegex("x", flags)).toEqual(expect.any(String));
    },
  );
  test("compiles patterns during authoring validation without matching", () => {
    expect(
      createExpressionSchemas({
        mode: "resolved",
        validateRegex,
      }).conditionsSchema.safeParse({
        matches: { string: "x", patterns: ["("] },
      }).success,
    ).toBe(false);
    // Compiling this is safe; author text is never matched by the schema.
    expect(validateRegex("^(a+)+$", "")).toBeUndefined();
  });
  test("caps the whole input without truncating it", () => {
    expect(
      matchPatterns("a".repeat(MAX_REGEX_INPUT_LENGTH), ["^a+$"], ""),
    ).toBe(true);
    expect(
      matchPatterns("a".repeat(MAX_REGEX_INPUT_LENGTH + 1), ["^a+$"], ""),
    ).toBe(false);
  });
  test("rejects oversized author patterns", () => {
    expect(
      validateRegex("a".repeat(MAX_REGEX_PATTERN_LENGTH + 1), ""),
    ).toContain("length");
  });
  test("invalid runtime patterns fail closed, and a missing answer cannot match", () => {
    expect(matchPatterns("a", ["("], "")).toBe(Missing);
    expect(
      evaluateExpression(
        { matches: { string: null, patterns: [".*"] } },
        { readReference: () => Missing },
      ),
    ).toBe(false);
  });
  test("negative leaves are exactly the negation even at the input cap", () => {
    const readReference = () => "a".repeat(MAX_REGEX_INPUT_LENGTH + 1);
    const positive = {
      reference: "self.prompt.answer",
      comparator: "matches",
      value: "/^a+$/i",
    };
    const negative = { ...positive, comparator: "doesNotMatch" };
    expect(evaluateExpression(positive, { readReference })).toBe(false);
    expect(evaluateExpression(negative, { readReference })).toBe(true);
    expect(evaluateExpression({ none: positive }, { readReference })).toBe(
      true,
    );
  });
});
