import {
  validateResolvedTreatmentFile,
  type TreatmentFileType,
} from "../../schemas/index.js";
import { expandTreatmentFile } from "./expandTreatmentFile.js";

export interface PostFillIssue {
  /** Dotted path into the filled tree, or "(root)" for top-level issues. */
  path: string;
  message: string;
  /**
   * The `${field}`s whose values produced the failing value, when the issue
   * sits in (or under) a placeholder slot. Absent for issues in literal
   * content.
   */
  fields?: string[];
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

  let filled: ReturnType<typeof expandTreatmentFile>;
  try {
    filled = expandTreatmentFile(treatmentFile, bindings);
  } catch (err) {
    // Filling a placeholder inside a longer string splices the value into
    // serialized JSON, so a quote or backslash in a value can break the
    // fill (#818). Report it like a validation failure, with the fields
    // editable, rather than crash the preview.
    const message = err instanceof Error ? err.message : String(err);
    return failureState(treatmentFile, merged, [
      { path: [], message: `Couldn't fill in the fields: ${message}` },
    ]);
  }
  const { result, unresolvedFields } = filled;

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
  return failureState(treatmentFile, merged, issues);
}

/** The form (or error) state for bindings that fill in but don't validate. */
function failureState(
  treatmentFile: TreatmentFileType,
  merged: Record<string, unknown>,
  issues: { path: (string | number)[]; message: string }[],
): PreviewState {
  // The bindings-free expansion still holds each `${field}` where the
  // filled tree holds its value, so it names the fields behind an issue —
  // and lists the file's fillable fields for the form (the with-bindings
  // pass reported none unresolved, but the user may revise any of them).
  const base = expandTreatmentFile(treatmentFile);
  const errors: PostFillIssue[] = issues.map((issue) => {
    const fields = fieldsAtPath(base.result, issue.path);
    return {
      path: issue.path.join(".") || "(root)",
      message: issue.message,
      ...(fields.length > 0 && { fields }),
    };
  });

  const baseFields = base.unresolvedFields;
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

/**
 * The `${field}` names in the unfilled tree at `path`, or at the nearest
 * ancestor that is a string: a substituted structure (a list, an object) can
 * fail below the slot its placeholder occupied.
 */
function fieldsAtPath(
  unfilled: unknown,
  path: readonly (string | number)[],
): string[] {
  let node = unfilled;
  for (const key of path) {
    if (node === null || typeof node !== "object") break;
    node = (node as Record<string | number, unknown>)[key];
  }
  if (typeof node !== "string") return [];
  return [
    ...new Set(Array.from(node.matchAll(FIELD_PLACEHOLDER), (m) => m[1])),
  ];
}

const FIELD_PLACEHOLDER = /\$\{([a-zA-Z0-9_]+)\}/g;

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
