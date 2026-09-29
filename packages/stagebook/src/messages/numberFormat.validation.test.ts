import { describe, expect, test } from "vitest";
import { isNumberFormat } from "./numberFormat.js";

describe("isNumberFormat", () => {
  test.each([
    null,
    undefined,
    ".",
    1,
    [],
    [".", ","],
    {},
    { decimal: "." },
    { grouping: "," },
    { decimal: undefined, grouping: "," },
    { decimal: ".", grouping: null },
    { decimal: 1, grouping: "," },
    { decimal: ".", grouping: 1 },
    { decimal: "", grouping: "," },
    { decimal: ".", grouping: "" },
    { decimal: ".", grouping: "." },
    { decimal: "..", grouping: "," },
    { decimal: ".", grouping: ",," },
    { decimal: "😀", grouping: "," },
    { decimal: "1", grouping: "," },
    { decimal: ".", grouping: "0" },
    { decimal: "١", grouping: "," },
    { decimal: ".", grouping: "９" },
    { decimal: "²", grouping: "," },
    { decimal: ".", grouping: "Ⅳ" },
    { decimal: "-", grouping: "," },
    { decimal: ".", grouping: "-" },
    { decimal: " ", grouping: "," },
    { decimal: "\u00a0", grouping: "," },
    { decimal: "\u202f", grouping: "," },
    { decimal: "\t", grouping: "," },
    { decimal: "\n", grouping: "," },
    { decimal: ".", grouping: "\t" },
    { decimal: ".", grouping: "\n" },
    { decimal: ".", grouping: "\r" },
    { decimal: ".", grouping: "\u2003" },
  ])("rejects incomplete or ambiguous pair %j", (value) => {
    expect(isNumberFormat(value)).toBe(false);
  });

  test.each([
    { decimal: ".", grouping: "," },
    { decimal: ",", grouping: "." },
    { decimal: ".", grouping: " " },
    { decimal: ".", grouping: "\u00a0" },
    { decimal: ",", grouping: "\u202f" },
    { decimal: "[", grouping: "]" },
    { decimal: "*", grouping: "\\" },
    { decimal: "(", grouping: "|" },
    { decimal: ".", grouping: ",", extra: "ignored" },
  ])("accepts complete literal pair %j", (value) => {
    expect(isNumberFormat(value)).toBe(true);
  });
});
