import { load as loadYaml } from "js-yaml";
import { safeParseTreatmentFile, type TreatmentFileType } from "stagebook";

export { expandTreatmentFile } from "stagebook/viewer";

export interface ValidationIssue {
  path: string;
  message: string;
}

export class TreatmentValidationError extends Error {
  issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const summary = issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
    super(`Treatment file validation failed:\n${summary}`);
    this.name = "TreatmentValidationError";
    this.issues = issues;
  }
}

/**
 * Parse a YAML string as a treatment file, validating against the schema.
 * Throws TreatmentValidationError with structured issues on failure.
 */
export function parseTreatmentYaml(yaml: string): TreatmentFileType {
  const raw = loadYaml(yaml);
  // Use stagebook's enriched parser (#123) so unrecognized-key issues
  // surface with rich messages + structured params instead of Zod's
  // bare default. Other issue codes pass through unchanged.
  const result = safeParseTreatmentFile(raw);
  if (!result.success) {
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
    throw new TreatmentValidationError(issues);
  }
  return result.data;
}
