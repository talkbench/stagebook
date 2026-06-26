import { describe, it, expect } from "vitest";
import { needsOverviewPicker } from "./selection";
import type { TreatmentFileType } from "stagebook";

// `introSequences` is `any`-typed in the built .d.ts (altTemplateContext), so
// tsc can't catch a `.length`-on-undefined regression here — these tests are
// the guard. A treatments-only file (no `introSequences:`) is valid and must
// not throw. (This computation crashed on such files; see #479.)

function file(parts: Partial<TreatmentFileType>): TreatmentFileType {
  return parts as TreatmentFileType;
}

describe("needsOverviewPicker", () => {
  it("does not throw on a treatments-only file (no introSequences)", () => {
    expect(() =>
      needsOverviewPicker(file({ treatments: [{ name: "t1" }] as never })),
    ).not.toThrow();
  });

  it("is false for a single treatment and no intro sequences", () => {
    expect(
      needsOverviewPicker(file({ treatments: [{ name: "t1" }] as never })),
    ).toBe(false);
  });

  it("is true with 2+ treatments (even with no intro sequences)", () => {
    expect(
      needsOverviewPicker(
        file({ treatments: [{ name: "a" }, { name: "b" }] as never }),
      ),
    ).toBe(true);
  });

  it("is true with 2+ intro sequences", () => {
    expect(
      needsOverviewPicker(
        file({
          introSequences: [{ name: "i1" }, { name: "i2" }] as never,
          treatments: [{ name: "t1" }] as never,
        }),
      ),
    ).toBe(true);
  });
});
