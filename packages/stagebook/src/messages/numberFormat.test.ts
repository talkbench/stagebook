import { afterEach, expect, test, vi } from "vitest";
import {
  resolveCatalog,
  resolveNumberFormat,
  defaultMessages,
} from "./index.js";
import type { DeepPartial, StagebookMessages } from "./types.js";
import { resolveNumberFormat as mainResolveNumberFormat } from "../index.js";

afterEach(() => vi.restoreAllMocks());

test("number formats follow locale normalization and the main React-free export", () => {
  for (const locale of [undefined, "", "en", "EN-US", "he", "he-IL"]) {
    expect(resolveNumberFormat(locale)).toEqual({
      decimal: ".",
      grouping: ",",
    });
    expect(mainResolveNumberFormat(locale)).toEqual(
      resolveCatalog(locale).numberFormat,
    );
  }
});

test("unknown locales share catalog fallback and warnings", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(
    resolveNumberFormat("unknown", { numberFormat: { grouping: " " } }),
  ).toEqual({
    decimal: ".",
    grouping: " ",
  });
  expect(warn).toHaveBeenCalledOnce();
  expect(warn.mock.calls[0][0]).toContain("Unknown locale");
});

test("partial formats merge field by field without changing the bundled entry", () => {
  expect(
    resolveCatalog("he", { numberFormat: { grouping: " " } }).numberFormat,
  ).toEqual({
    decimal: ".",
    grouping: " ",
  });
  expect(resolveNumberFormat("en", { numberFormat: { decimal: ":" } })).toEqual(
    {
      decimal: ":",
      grouping: ",",
    },
  );
  expect(
    resolveNumberFormat("en", {
      numberFormat: { decimal: ",", grouping: "." },
    }),
  ).toEqual({
    decimal: ",",
    grouping: ".",
  });
  expect(defaultMessages.en.numberFormat).toEqual({
    decimal: ".",
    grouping: ",",
  });
  expect(defaultMessages.he.numberFormat).toEqual({
    decimal: ".",
    grouping: ",",
  });
});

for (const grouping of [" ", "\u00a0", "\u202f"]) {
  test(`permits grouping space ${JSON.stringify(grouping)}`, () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveNumberFormat("en", { numberFormat: { grouping } })).toEqual({
      decimal: ".",
      grouping,
    });
    expect(warn).not.toHaveBeenCalled();
  });
}

for (const numberFormat of [
  null,
  [],
  "not an object",
  { decimal: "" },
  { grouping: "" },
  { decimal: "12" },
  { grouping: ".." },
  { decimal: "1" },
  { decimal: "١" },
  { grouping: "９" },
  { grouping: "7" },
  { decimal: "-" },
  { grouping: "-" },
  { decimal: " " },
  { decimal: "\u00a0" },
  { decimal: "\u202f" },
  { decimal: "\n" },
  { grouping: "\t" },
  { grouping: "\n" },
  { decimal: "," },
  { grouping: "." },
  { decimal: ":", grouping: ":" },
  { decimal: 1 },
  { grouping: false },
]) {
  test(`rejects ambiguous or malformed format ${JSON.stringify(numberFormat)}`, () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const overrides = {
      numberFormat,
    } as unknown as DeepPartial<StagebookMessages>;
    expect(resolveNumberFormat("en", overrides)).toEqual({
      decimal: ".",
      grouping: ",",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("numberFormat");
  });
}

test("separator punctuation is treated as data, not a regular expression", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const decimal of ["[", "*", "\\", "+"]) {
    expect(resolveNumberFormat("en", { numberFormat: { decimal } })).toEqual({
      decimal,
      grouping: ",",
    });
  }
  expect(warn).not.toHaveBeenCalled();
});
