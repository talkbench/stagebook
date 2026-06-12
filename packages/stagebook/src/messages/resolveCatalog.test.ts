import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveCatalog,
  isRTLLocale,
  defaultMessages,
  REGISTERED_LOCALES,
} from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveCatalog — locale selection", () => {
  it("returns the English catalog for 'en'", () => {
    expect(resolveCatalog("en").submitButtonDefault).toBe("Next");
  });

  it("returns the Hebrew catalog for 'he'", () => {
    expect(resolveCatalog("he").submitButtonDefault).toBe("הבא");
  });

  it("normalizes a region-tagged locale to its primary subtag", () => {
    expect(resolveCatalog("he-IL").submitButtonDefault).toBe("הבא");
    expect(resolveCatalog("EN-US").submitButtonDefault).toBe("Next");
  });

  it("falls back to English (with a warning) for an unknown locale", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveCatalog("fr").submitButtonDefault).toBe("Next");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('Unknown locale "fr"');
  });

  it("falls back to English silently for undefined / empty locale", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveCatalog(undefined).submitButtonDefault).toBe("Next");
    expect(resolveCatalog("").submitButtonDefault).toBe("Next");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveCatalog — host overrides", () => {
  it("applies a valid string override over the base catalog", () => {
    const c = resolveCatalog("en", { submitButtonDefault: "Continue" });
    expect(c.submitButtonDefault).toBe("Continue");
    // unrelated keys are untouched
    expect(c.loadingLabel).toBe("Loading");
  });

  it("applies a valid function override (interpolating key)", () => {
    const c = resolveCatalog("en", {
      charCount: (n) => `count=${n}`,
    });
    expect(c.charCount(5)).toBe("count=5");
  });

  it("overrides on top of a non-English base", () => {
    const c = resolveCatalog("he", { loadingLabel: "…" });
    expect(c.loadingLabel).toBe("…");
    expect(c.submitButtonDefault).toBe("הבא"); // still Hebrew
  });

  it("ignores a malformed override (wrong runtime type) with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A function key handed a string (e.g. from an untyped JS consumer).
    const c = resolveCatalog("en", {
      charCount: "oops" as unknown as (n: number) => string,
    });
    // Bundled function is preserved — render doesn't crash.
    expect(typeof c.charCount).toBe("function");
    expect(c.charCount(3)).toBe("(3 characters)");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("charCount");
  });

  it("does not mutate the bundled catalog when applying overrides", () => {
    resolveCatalog("en", { submitButtonDefault: "Continue" });
    expect(defaultMessages.en.submitButtonDefault).toBe("Next");
  });
});

describe("isRTLLocale", () => {
  it("is true for Hebrew (incl. region tags)", () => {
    expect(isRTLLocale("he")).toBe(true);
    expect(isRTLLocale("he-IL")).toBe(true);
  });

  it("is false for English, unknown, and undefined", () => {
    expect(isRTLLocale("en")).toBe(false);
    expect(isRTLLocale("fr")).toBe(false);
    expect(isRTLLocale(undefined)).toBe(false);
  });
});

describe("catalog completeness", () => {
  it("every registered locale implements the same key set", () => {
    const enKeys = Object.keys(defaultMessages.en).sort();
    for (const locale of REGISTERED_LOCALES) {
      expect(Object.keys(defaultMessages[locale]).sort()).toEqual(enKeys);
    }
  });
});
