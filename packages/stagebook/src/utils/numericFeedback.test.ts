import { describe, expect, test } from "vitest";
import { resolveCatalog } from "../messages/index.js";
import { getNumericFeedback } from "./numericFeedback.js";
import type { NumericConstraints } from "./numericResponse.js";

describe.each(["en", "he", "override"])("numeric feedback: %s", (locale) => {
  const messages = resolveCatalog(
    locale === "override" ? "en" : locale,
    locale === "override"
      ? { numberFormat: { decimal: ",", grouping: "." } }
      : undefined,
  );
  const format = messages.numberFormat;
  const f = (
    entry: string,
    constraints: NumericConstraints = {},
    reveal = false,
  ) =>
    getNumericFeedback(
      entry.replaceAll(".", format.decimal),
      constraints,
      format,
      reveal,
      messages,
    );

  test.each(["", "  "])("blank %j always has neutral guidance", (entry) => {
    expect(f(entry, { required: true, min: 18 }, true)).toEqual({
      state: "neutral",
      text: messages.numericGuidance(false, "18"),
    });
  });
  test("appendable entries stay neutral until blur; valid entries turn green", () => {
    expect(f("3", { min: 18, max: 99 }).state).toBe("neutral");
    expect(f("3", { min: 18 }, true)).toEqual({
      state: "problem",
      text: `ⓘ ${messages.numericLessThan("3", "18")}`,
    });
    expect(f("35", { min: 18, max: 99 }, true)).toEqual({
      state: "valid",
      text: `✓ ${messages.numericGuidance(false, "18", "99")}`,
    });
  });
  test("impossible prefixes reveal immediately and quote canonical parsed numbers", () => {
    expect(f("00025", { max: 20 })).toEqual({
      state: "problem",
      text: `ⓘ ${messages.numericMoreThan("25", "20")}`,
    });
    expect(f("2", { max: 20 }).state).toBe("valid");
    expect(f("1.5", { integer: true })).toEqual({
      state: "problem",
      text: `ⓘ ${messages.numericWholeNumber}`,
    });
    expect(f("-", { min: 1 })).toEqual({
      state: "problem",
      text: `ⓘ ${messages.numericUnfinished}`,
    });
  });
  test.each([
    ["5.", "numericUnfinished"],
    ["3-4", "numericNotNumber"],
    ["1234567890123456", "numericTooManyDigits"],
    ["1".repeat(400), "numericTooLong"],
  ] as const)("restored %s has the catalog problem", (entry, key) => {
    expect(f(entry, {}, true)).toEqual({
      state: "problem",
      text: `ⓘ ${messages[key]}`,
    });
  });
  test("guidance uses plain bounds with the supplied decimal separator", () => {
    expect(f("", { min: 1e-7, max: 1000000 }).text).toBe(
      messages.numericGuidance(false, `0${format.decimal}0000001`, "1000000"),
    );
  });
});
