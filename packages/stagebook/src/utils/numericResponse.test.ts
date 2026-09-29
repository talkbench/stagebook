import { describe, expect, test } from "vitest";
import {
  couldBecomeValidByAppending,
  filterNumericInsertion,
  formatNumericPlain,
  numericInputMode,
  parseNumericEntry,
  type NumericConstraints,
} from "./numericResponse.js";

const en = { decimal: ".", grouping: "," };
const comma = { decimal: ",", grouping: "." };

describe("parseNumericEntry", () => {
  test.each([
    ["3", 3],
    ["-3", -3],
    ["3.5", 3.5],
    [".5", 0.5],
    ["-.5", -0.5],
    ["007", 7],
    ["-0", 0],
    ["-0.00", 0],
    ["  3  ", 3],
    ["\u00a0\t3\n", 3],
    ["000123456789012345", 123456789012345],
    ["0.000000000000000123456789012345", 0.000000000000000123456789012345],
    ["0".repeat(100), 0],
    ["." + "0".repeat(98) + "1", 1e-99],
  ])("parses %j as %s", (entry, value) => {
    const parsed = parseNumericEntry(entry, en);
    expect(parsed).toEqual({ status: "parsed", value });
    if (value === 0 && parsed.status === "parsed")
      expect(Object.is(parsed.value, 0)).toBe(true);
  });

  test.each([
    ["", "blank"],
    [" \t\n", "blank"],
    ["5.", "unfinished"],
    ["-", "unfinished"],
    [".", "unfinished"],
    ["-.", "unfinished"],
    ["3-4", "malformed"],
    ["1.2.3", "malformed"],
    ["1e3", "malformed"],
    ["0x10", "malformed"],
    ["1,000", "malformed"],
    ["+3", "malformed"],
    ["٣", "malformed"],
    ["３", "malformed"],
    ["3 5", "malformed"],
    ["1234567890123456", "tooManyDigits"],
    ["123456789012345.0", "tooManyDigits"],
    ["0.1234567890123450", "tooManyDigits"],
    ["0".repeat(101), "tooLong"],
    ["9".repeat(400), "tooLong"],
    [" ".repeat(101), "tooLong"],
    ["x".repeat(400), "tooLong"],
  ])("classifies %j as %s without a value", (entry, status) => {
    expect(parseNumericEntry(entry, en)).toEqual({ status });
  });

  test("takes separators literally, without dynamic regular expressions", () => {
    expect(parseNumericEntry("1,5", comma)).toEqual({
      status: "parsed",
      value: 1.5,
    });
    expect(parseNumericEntry("1.5", comma)).toEqual({ status: "malformed" });
    for (const decimal of ["[", "]", "*", "\\", "(", "|"]) {
      expect(
        parseNumericEntry(`1${decimal}5`, { decimal, grouping: "," }),
      ).toEqual({ status: "parsed", value: 1.5 });
    }
  });
});

describe("couldBecomeValidByAppending", () => {
  const cases: [string, NumericConstraints, boolean][] = [
    ...["3", "2", "1", "0"].map(
      (entry): [string, NumericConstraints, boolean] => [
        entry,
        { min: 18, max: 99 },
        true,
      ],
    ),
    ["-", { min: 18, max: 99 }, false],
    ["100", { min: 18, max: 99 }, false],
    ["25", { min: 1, max: 20, integer: true }, false],
    ["1.", { min: 1, max: 20, integer: true }, true],
    ["1.5", { min: 1, max: 20, integer: true }, false],
    ["-", { min: 1, max: 20, integer: true }, false],
    ["3-", { min: 1, max: 20, integer: true }, false],
    ["-", { min: -10, max: 10 }, true],
    ["5", { min: -10, max: -1 }, false],
    ["-0", { min: -10, max: -1 }, true],
    ["-", { min: 0 }, true],
    ["-", { min: -10 }, true],
    ["-", { max: 10 }, true],
    ["-", { max: -10 }, true],
    ["-", { min: 1 }, false],
    ["0.4", { min: 0.5, max: 1 }, false],
    ["1.", { min: 0.5, max: 1 }, true],
    ["1.1", { min: 0.5, max: 1 }, false],
    // Exact decimal grids: equality at a boundary must be reachable, not just a limit.
    ["0.4", { min: 0.499999999999999, max: 0.499999999999999 }, true],
    ["0.499999999999999", { min: 0.5 }, false],
    ["-0.4", { min: -0.5, max: -0.5 }, false],
    ["-0.4", { min: -0.499999999999999, max: -0.499999999999999 }, true],
    ["12345678901234", { min: 123456789012345, max: 123456789012345 }, true],
    ["123456789012345.", {}, false],
    ["1234567890123450", {}, false],
    [
      "000000000000000.",
      { min: 0.123456789012345, max: 0.123456789012345 },
      true,
    ],
    [".000000000000001", { min: 1e-15, max: 1e-15 }, true],
    [".000000000000001", { min: 2e-15 }, false],
    ["000", { min: 999999999999999, max: 999999999999999 }, true],
    ["-0.0", { min: 0, max: 0, integer: true }, true],
    ["-0.1", { min: 0, max: 0, integer: true }, false],
    // Whole-number checks use divisibility on the exact grid.
    ["12.", { min: 12, max: 12, integer: true }, true],
    ["12.0", { min: 13, integer: true }, false],
    ["0.99999999999999", { min: 1, integer: true }, false],
    // Actual raw text, not a trimmed reconstruction, is extended.
    ["3 ", { min: 18 }, false],
    [" 3", { min: 18 }, true],
    [" - ", { min: -10, max: -1 }, false],
    [" \t", { required: true, min: 18 }, true],
    [" 18 ", { min: 18, max: 18 }, true],
    [" ".repeat(99), { required: true, min: 1, max: 1 }, true],
    [" ".repeat(100), { required: true }, false],
    [" ".repeat(100), {}, true], // Empty suffix already satisfies optional blank.
    ["0".repeat(98), { min: 18, max: 18 }, true],
    ["0".repeat(99), { min: 18, max: 18 }, false],
    ["." + "0".repeat(97), { min: 1e-98, max: 1e-98 }, true],
    ["." + "0".repeat(98), { min: 1e-98, max: 1e-98 }, false],
    ["." + "0".repeat(98), { min: 1e-99, max: 1e-99 }, true],
    ["." + "0".repeat(99), { min: 1e-99 }, false],
    ["0".repeat(101), {}, false],
    ["9".repeat(400), {}, false],
    ["", { required: true, min: -2, max: -1 }, true],
    [".", { min: -2, max: -1 }, false],
  ];
  test.each(cases)(
    "%j under %j has feasibility %s",
    (entry, constraints, expected) => {
      expect(couldBecomeValidByAppending(entry, constraints, en)).toBe(
        expected,
      );
    },
  );
  test("uses the supplied decimal separator", () => {
    expect(
      couldBecomeValidByAppending(
        "1,",
        { min: 1, max: 1, integer: true },
        comma,
      ),
    ).toBe(true);
    expect(couldBecomeValidByAppending("1.", {}, comma)).toBe(false);
  });
});

describe("filterNumericInsertion", () => {
  test.each(["x", " ", "+", ","])(
    "refuses %j without erasing a selection",
    (inserted) => {
      expect(
        filterNumericInsertion({ entry: "35", start: 0, end: 2, inserted }, en),
      ).toEqual({
        entry: "35",
        selectionStart: 0,
        selectionEnd: 2,
        accepted: false,
        refused: true,
      });
      expect(
        filterNumericInsertion({ entry: "35", start: 1, end: 1, inserted }, en),
      ).toEqual({
        entry: "35",
        selectionStart: 1,
        selectionEnd: 1,
        accepted: false,
        refused: true,
      });
    },
  );
  test("filters mixed insertions and places the caret after the accepted text", () => {
    expect(
      filterNumericInsertion(
        { entry: "35", start: 1, end: 1, inserted: "x2,4!" },
        en,
      ),
    ).toEqual({
      entry: "3245",
      selectionStart: 3,
      selectionEnd: 3,
      accepted: true,
      refused: true,
    });
  });
  test("accepts minus and decimal anywhere, independently of grammar or constraints", () => {
    expect(
      filterNumericInsertion(
        { entry: "35", start: 1, end: 1, inserted: "-." },
        en,
      ),
    ).toEqual({
      entry: "3-.5",
      selectionStart: 3,
      selectionEnd: 3,
      accepted: true,
      refused: false,
    });
    expect(
      filterNumericInsertion(
        { entry: "", start: 0, end: 0, inserted: "1.000,5" },
        comma,
      ).entry,
    ).toBe("1000,5");
  });
  test("refuses an overflowing insertion whole; never truncates", () => {
    const entry = "0".repeat(99);
    expect(
      filterNumericInsertion({ entry, start: 99, end: 99, inserted: "12" }, en),
    ).toEqual({
      entry,
      selectionStart: 99,
      selectionEnd: 99,
      accepted: false,
      refused: true,
    });
    expect(
      filterNumericInsertion({ entry, start: 98, end: 99, inserted: "12" }, en)
        .entry,
    ).toBe("0".repeat(98) + "12");
  });
  test("over-cap remote text permits pure deletion, but refuses even shortening replacements", () => {
    const entry = "0".repeat(400);
    expect(
      filterNumericInsertion({ entry, start: 10, end: 20, inserted: "" }, en),
    ).toEqual({
      entry: "0".repeat(390),
      selectionStart: 10,
      selectionEnd: 10,
      accepted: true,
      refused: false,
    });
    expect(
      filterNumericInsertion({ entry, start: 0, end: 400, inserted: "1" }, en),
    ).toEqual({
      entry,
      selectionStart: 0,
      selectionEnd: 400,
      accepted: false,
      refused: true,
    });
  });
  test("reports accepted replacement even when the resulting value is equal", () => {
    expect(
      filterNumericInsertion(
        { entry: "35", start: 0, end: 1, inserted: "3" },
        en,
      ),
    ).toEqual({
      entry: "35",
      selectionStart: 1,
      selectionEnd: 1,
      accepted: true,
      refused: false,
    });
  });
});

describe("formatNumericPlain and numericInputMode", () => {
  test.each([
    [1e-7, "0.0000001"],
    [1e6, "1000000"],
    [1e15, "1000000000000000"],
    [1.23e21, "1230000000000000000000"],
    [-2.5, "-2.5"],
    [-0, "0"],
    [1.23e-7, "0.000000123"],
  ])("formats %s as %s without grouping/exponents", (value, expected) => {
    expect(formatNumericPlain(value, en)).toBe(expected);
    expect(formatNumericPlain(value, comma)).toBe(expected.replace(".", ","));
  });
  test("plain bounds go through the same raw length and significant-digit rules", () => {
    expect(parseNumericEntry(formatNumericPlain(1e15, en), en)).toEqual({
      status: "tooManyDigits",
    });
    expect(parseNumericEntry(formatNumericPlain(1e-98, en), en)).toEqual({
      status: "parsed",
      value: 1e-98,
    });
    expect(parseNumericEntry(formatNumericPlain(1e-99, en), en)).toEqual({
      status: "tooLong",
    });
    expect(parseNumericEntry(formatNumericPlain(-1e-97, en), en)).toEqual({
      status: "parsed",
      value: -1e-97,
    });
    expect(parseNumericEntry(formatNumericPlain(-1e-98, en), en)).toEqual({
      status: "tooLong",
    });
  });
  test.each([
    [{}, undefined],
    [{ max: 10 }, undefined],
    [{ min: 0 }, undefined],
    [{ min: 0, integer: true }, "numeric"],
    [{ min: -1, integer: true }, undefined],
    [{ min: 1, integer: true }, "numeric"],
    [{ integer: true }, undefined],
  ])("chooses a keyboard for %j", (constraints, expected) => {
    expect(numericInputMode(constraints)).toBe(expected);
  });
});
