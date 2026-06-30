import { describe, it, expect } from "vitest";
import {
  summarizeDiagnostics,
  formatValidationStatusBar,
} from "./diagnosticSummary";

describe("summarizeDiagnostics", () => {
  it("returns zeros for no files", () => {
    expect(summarizeDiagnostics([])).toEqual({
      errors: 0,
      warnings: 0,
      filesWithDiagnostics: 0,
    });
  });

  it("counts errors and warnings across files", () => {
    expect(
      summarizeDiagnostics([
        ["error", "warning"],
        ["error"],
        ["warning", "warning"],
      ]),
    ).toEqual({ errors: 2, warnings: 3, filesWithDiagnostics: 3 });
  });

  it("ignores files with no diagnostics when counting affected files", () => {
    expect(summarizeDiagnostics([["error"], [], [], ["warning"]])).toEqual({
      errors: 1,
      warnings: 1,
      filesWithDiagnostics: 2,
    });
  });
});

describe("formatValidationStatusBar", () => {
  it("reports a clean run with no issues", () => {
    const { text } = formatValidationStatusBar(
      { errors: 0, warnings: 0, filesWithDiagnostics: 0 },
      12,
    );
    expect(text).toBe("$(check) Stagebook: no issues in 12 files");
  });

  it("pluralizes errors and warnings", () => {
    const { text } = formatValidationStatusBar(
      { errors: 2, warnings: 3, filesWithDiagnostics: 4 },
      30,
    );
    expect(text).toBe(
      "$(warning) Stagebook: 2 errors, 3 warnings across 30 files",
    );
  });

  it("uses singular forms for a single error/warning/file", () => {
    const { text } = formatValidationStatusBar(
      { errors: 1, warnings: 1, filesWithDiagnostics: 1 },
      1,
    );
    expect(text).toBe("$(warning) Stagebook: 1 error, 1 warning across 1 file");
  });

  it("tooltip mentions the affected-file count and the click action", () => {
    const { tooltip } = formatValidationStatusBar(
      { errors: 1, warnings: 0, filesWithDiagnostics: 1 },
      5,
    );
    expect(tooltip).toContain("1 file");
    expect(tooltip.toLowerCase()).toContain("problems");
  });
});
