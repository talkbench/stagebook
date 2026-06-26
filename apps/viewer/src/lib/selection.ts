import type { TreatmentFileType } from "stagebook";

/**
 * Whether the overview/picker screen is needed before viewing a treatment.
 *
 * True when there's a choice to make: 2+ intro sequences or 2+ treatments.
 *
 * `introSequences` is optional in the schema (a treatments-only file is
 * valid), and — critically — `altTemplateContext` types it as `any` in the
 * built `.d.ts`, so tsc will NOT flag a bare `.length` here. The `?? 0`
 * guard is load-bearing: a treatments-only file previously crashed this exact
 * computation. Kept as a pure, tested function so a regression can't slip past
 * the type checker (it can't see the optionality) AND the test suite.
 */
export function needsOverviewPicker(treatmentFile: TreatmentFileType): boolean {
  return (
    (treatmentFile.introSequences?.length ?? 0) > 1 ||
    treatmentFile.treatments.length > 1
  );
}
