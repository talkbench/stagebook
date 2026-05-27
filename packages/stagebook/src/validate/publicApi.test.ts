import { describe, it, expect } from "vitest";
import * as validate from "./index.js";

// Barrel-regression guard: every name listed here is part of the
// stagebook/validate public contract consumed by the VS Code extension,
// the CLI (#439), the viewer (#440), the GitHub Action (#441), and the
// extension's Validate-Workspace command (#442). Removing or renaming
// any of these is a breaking change — surface it here instead of in a
// downstream consumer's red squiggly.

const EXPECTED_FUNCTIONS = [
  "validateTreatmentSource",
  "validatePromptSource",
  "validateTreatmentWithDiff",
  "expandAndValidate",
  "expandAndValidateWithImports",
  "expandTreatmentSource",
  "expandTreatmentSourceWithImports",
  "parseTreatmentSource",
  "loadAndMergeImports",
  "createPositionMapper",
  "pathToRange",
  "extractYamlErrors",
  "remapErrorPath",
  "offsetToLineCol",
] as const;

describe("stagebook/validate public API", () => {
  it.each(EXPECTED_FUNCTIONS)("exports %s as a function", (name) => {
    expect(typeof (validate as Record<string, unknown>)[name]).toBe("function");
  });

  it("exports UNRECOGNIZED_KEY_DID_YOU_MEAN_RE as a RegExp", () => {
    expect(validate.UNRECOGNIZED_KEY_DID_YOU_MEAN_RE).toBeInstanceOf(RegExp);
  });
});
