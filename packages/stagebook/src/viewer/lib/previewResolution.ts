import {
  validateResolvedTreatmentFile,
  type TreatmentFileType,
} from "../../schemas/index.js";
import { expandTreatmentFile } from "./expandTreatmentFile.js";

export interface PostFillIssue {
  /** Dotted path into the filled tree, or "(root)" for top-level issues. */
  path: string;
  message: string;
}

export type PreviewState =
  | {
      mode: "form";
      formFields: string[];
      initialValues: Record<string, string>;
      errors: PostFillIssue[];
    }
  | { mode: "error"; errors: PostFillIssue[] }
  | { mode: "ready"; resolved: TreatmentFileType };

/**
 * Decide what the preview should render for a treatment file given the
 * host-supplied `${field}` bindings and the values the user entered
 * into FieldForm (user values take precedence on overlap).
 *
 * - Fields still unbound → `form` (no errors yet — validating a
 *   partially-filled tree would bury the "we need bindings" path
 *   under unresolved-placeholder noise).
 * - All bound but post-fill validation fails (#398) and the file has
 *   user-editable fields → `form` again, with the submitted values and
 *   the validation errors, so the user can fix their inputs in place
 *   rather than hitting a dead-end error page (#474). Host-bound
 *   fields become editable here too — overriding a bad sidecar value
 *   is the only recovery path when the host supplied it. Fields bound
 *   to non-string values are excluded: they can't round-trip through
 *   a text input, and coercing them to strings would corrupt slots
 *   the schema expects to be structural (numbers, arrays).
 * - Post-fill failure with no user-editable fields → `error` (nothing
 *   the form could fix; the file itself is broken).
 * - Otherwise → `ready`.
 */
export function computePreviewState(
  treatmentFile: TreatmentFileType,
  additionalFields?: Record<string, unknown>,
  userValues?: Record<string, string>,
): PreviewState {
  const merged = { ...(additionalFields ?? {}), ...(userValues ?? {}) };
  const bindings = Object.keys(merged).length > 0 ? merged : undefined;

  const { result, unresolvedFields } = expandTreatmentFile(
    treatmentFile,
    bindings,
  );

  if (unresolvedFields.length > 0) {
    return {
      mode: "form",
      formFields: unresolvedFields,
      initialValues: stringBindings(merged, unresolvedFields),
      errors: [],
    };
  }

  const { issues } = validateResolvedTreatmentFile(result);
  if (issues.length === 0) {
    return { mode: "ready", resolved: result };
  }

  const errors: PostFillIssue[] = issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));

  // Re-derive the file's fillable fields from a bindings-free
  // expansion: the with-bindings pass reported none unresolved, but
  // the form needs the full set to let the user revise their answers.
  const baseFields = expandTreatmentFile(treatmentFile).unresolvedFields;
  const formFields = baseFields.filter((field) => {
    const value = merged[field];
    return value === undefined || typeof value === "string";
  });
  if (formFields.length === 0) {
    return { mode: "error", errors };
  }

  return {
    mode: "form",
    formFields,
    initialValues: stringBindings(merged, formFields),
    errors,
  };
}

/** Restrict bindings to string values for the given fields — FieldForm
 * inputs only carry strings; host-supplied non-string context (e.g.
 * objects) can't round-trip through a text input. */
function stringBindings(
  bindings: Record<string, unknown>,
  fields: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = bindings[field];
    if (typeof value === "string") out[field] = value;
  }
  return out;
}
