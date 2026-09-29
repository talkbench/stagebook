import { describe, expect, test } from "vitest";
import { checkResponse } from "./checkResponse.js";

describe("checkResponse (#668)", () => {
  test.each([undefined, "", [], " ", "\n\t", "\u00a0", "\u3000"])(
    "blank optional %j passes even with a minimum",
    (response) => {
      expect(checkResponse(response, { minLength: 50 })).toEqual({
        isValid: true,
        blank: true,
      });
      expect(checkResponse(response, { required: true })).toEqual({
        isValid: false,
        blank: true,
        failed: "required",
      });
    },
  );

  test.each([0, false, ["yes"], "yes"])(
    "nonblank %j satisfies required",
    (response) => {
      expect(checkResponse(response, { required: true })).toEqual({
        isValid: true,
        blank: false,
      });
    },
  );

  test.each([
    ["abc", { minLength: 3 }, true],
    ["ab", { minLength: 3 }, false],
    ["abc", { maxLength: 3 }, true],
    ["abcd", { maxLength: 3 }, false],
    ["a" + " ".repeat(49), { minLength: 50 }, true],
    ["😀", { minLength: 2, maxLength: 2 }, true],
    ["😀", { maxLength: 1 }, false],
    ["a", { minLength: 0 }, true],
  ])(
    "counts untrimmed UTF-16 length for %j with %j",
    (response, constraints, valid) => {
      expect(checkResponse(response, constraints).isValid).toBe(valid);
    },
  );

  test("reports the failed length constraint", () => {
    expect(checkResponse("a", { minLength: 2 })).toEqual({
      isValid: false,
      blank: false,
      failed: "minLength",
    });
    expect(checkResponse("abc", { maxLength: 2 })).toEqual({
      isValid: false,
      blank: false,
      failed: "maxLength",
    });
  });

  test("non-string responses do not acquire text-length constraints", () => {
    expect(
      checkResponse(["yes"], { minLength: 50, maxLength: 1 }).isValid,
    ).toBe(true);
    expect(checkResponse(0, { minLength: 50 }).isValid).toBe(true);
  });
});
