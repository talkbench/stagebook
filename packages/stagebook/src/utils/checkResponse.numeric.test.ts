import { describe, expect, test } from "vitest";
import { checkResponse } from "./checkResponse.js";
import type { NumericConstraints } from "./numericResponse.js";

const numberFormat = { decimal: ".", grouping: "," };
const check = (entry: unknown, constraints: NumericConstraints = {}) =>
  checkResponse(entry, {
    type: "numericResponse",
    numberFormat,
    ...constraints,
  });

describe("numeric checkResponse", () => {
  test.each(["", " \t"])("blank %j is valid unless required", (entry) => {
    expect(check(entry, { min: 18, max: 99, integer: true })).toEqual({
      isValid: true,
      blank: true,
    });
    expect(check(entry, { required: true })).toEqual({
      isValid: false,
      blank: true,
      failed: "required",
    });
  });
  test.each([
    ["18", { min: 18, max: 99 }, undefined],
    ["99", { min: 18, max: 99 }, undefined],
    ["17.9999999999999", { min: 18, max: 99 }, "min"],
    ["99.0000000000001", { min: 18, max: 99 }, "max"],
    ["3.5", { integer: true }, "integer"],
    ["3.0", { integer: true }, undefined],
    ["0", { required: true }, undefined],
    ["-0", { min: 0, max: 0, integer: true }, undefined],
  ] as [string, NumericConstraints, string | undefined][])(
    "%j under %j reports %j",
    (entry, constraints, failed) => {
      expect(check(entry, constraints)).toEqual(
        failed
          ? { isValid: false, blank: false, failed }
          : { isValid: true, blank: false },
      );
    },
  );
  test.each([
    ["5.", "unfinished"],
    ["-", "unfinished"],
    ["3-4", "malformed"],
    ["1234567890123456", "tooManyDigits"],
    ["9".repeat(400), "tooLong"],
    [" ".repeat(101), "tooLong"],
  ])("reports the parse failure for %j", (entry, failed) => {
    expect(check(entry)).toEqual({ isValid: false, blank: false, failed });
  });
  test.each([undefined, null, 3, true, [], {}])(
    "does not coerce untyped %j",
    (entry) => {
      expect(check(entry)).toEqual({
        isValid: false,
        blank: false,
        failed: "malformed",
      });
    },
  );
  test("uses the explicit number format without changing text-response checks", () => {
    expect(
      checkResponse("1,5", {
        type: "numericResponse",
        numberFormat: { decimal: ",", grouping: "." },
        min: 1,
        max: 2,
      }),
    ).toEqual({ isValid: true, blank: false });
    expect(checkResponse("3-4", { required: true })).toEqual({
      isValid: true,
      blank: false,
    });
    expect(checkResponse("00123", { minLength: 5 })).toEqual({
      isValid: true,
      blank: false,
    });
  });
});
