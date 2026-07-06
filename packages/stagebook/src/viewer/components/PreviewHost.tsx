import { useMemo, useState } from "react";
import { type TreatmentFileType } from "../../schemas/index.js";
import { computePreviewState } from "../lib/previewResolution.js";
import { FieldForm } from "./FieldForm.js";
import { Viewer } from "./Viewer.js";

export interface PreviewHostProps {
  treatmentFile: TreatmentFileType;
  /**
   * Pre-supplied values for `${field}` placeholders (e.g. from a sidecar
   * file). Any placeholders not covered here will surface as a FieldForm.
   */
  additionalFields?: Record<string, unknown>;
  selectedIntroIndex: number;
  selectedTreatmentIndex: number;
  /** Must be referentially stable (memoized) to avoid re-fetch loops. */
  getTextContent: (path: string) => Promise<string>;
  /** Must be referentially stable (memoized) to avoid re-fetch loops. */
  getAssetURL: (path: string) => string;
  /** Optional — hidden in the header when omitted. */
  onBack?: () => void;
  /**
   * Called with the values the user entered into FieldForm, letting a host
   * persist them (e.g. write to a sidecar file). Not called when placeholders
   * are resolved purely from `additionalFields` — except after a post-fill
   * validation failure (#474), where host-bound string fields become editable
   * and a resubmit reports them too (the user may have overridden a bad
   * host-supplied value, and that override needs to persist).
   */
  onFieldsResolved?: (values: Record<string, string>) => void;
  /** Optional refresh affordance passed through to the Viewer header. */
  onRefresh?: () => void;
  /** Bump to force useTextContent to re-fetch all prompt files. */
  contentVersion?: number;
  /** Forwarded to Viewer to drive its treatment-selection dropdown. */
  onTreatmentIndexChange?: (index: number) => void;
  /** Forwarded to Viewer to drive its intro-sequence dropdown. */
  onIntroIndexChange?: (index: number) => void;
}

/**
 * Resolves `${field}` placeholders before rendering the Viewer.
 *
 * Stagebook components expect concrete values, but treatment files may
 * reference study/player-context variables that aren't available in a
 * preview environment. This host bridges the gap: it runs fillTemplates,
 * prompts the user for any remaining unresolved fields via FieldForm, and
 * only hands a fully-resolved treatment to the Viewer.
 */
export function PreviewHost({
  treatmentFile,
  additionalFields,
  selectedIntroIndex,
  selectedTreatmentIndex,
  getTextContent,
  getAssetURL,
  onBack,
  onFieldsResolved,
  onRefresh,
  contentVersion,
  onTreatmentIndexChange,
  onIntroIndexChange,
}: PreviewHostProps) {
  const [userValues, setUserValues] = useState<Record<string, string> | null>(
    null,
  );

  // Expansion + post-fill validation (#398) live in
  // computePreviewState. When validation fails on user-supplied
  // values, it routes back to `form` mode (with the errors and the
  // submitted values) instead of a dead-end error page (#474).
  const previewState = useMemo(
    () =>
      computePreviewState(treatmentFile, additionalFields, userValues ?? {}),
    [treatmentFile, additionalFields, userValues],
  );

  if (previewState.mode === "form") {
    // Keyed on the field set: after a post-fill failure the form can
    // gain fields (host-bound ones become editable), and FieldForm
    // only reads initialValues on mount. The remount is lossless —
    // everything the user typed is in `userValues` and comes back via
    // initialValues.
    return (
      <FieldForm
        key={previewState.formFields.join(" ")}
        unresolvedFields={previewState.formFields}
        initialValues={previewState.initialValues}
        errors={previewState.errors}
        onSubmit={(values) => {
          setUserValues(values);
          onFieldsResolved?.(values);
        }}
      />
    );
  }

  if (previewState.mode === "error") {
    // Post-fill validation failed and the file has no fillable
    // fields — nothing a form could fix, so show the error panel.
    // Matches the shape that `TreatmentValidationError` produces for
    // pre-fill issues, so a future unification can route both
    // through the same UI surface.
    return (
      <div
        style={{
          padding: "1.5rem",
          maxWidth: "48rem",
          margin: "2rem auto",
          fontFamily: "system-ui, sans-serif",
          color: "var(--stagebook-text, #1f2937)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Post-fill validation failed</h2>
        <p>
          The treatment file expanded successfully, but the filled tree contains
          issues that would surface to participants. Fix these before
          continuing.
        </p>
        <ul>
          {previewState.errors.map((issue, i) => (
            <li key={i}>
              <code>{issue.path}</code>: {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <Viewer
      treatmentFile={previewState.resolved}
      getTextContent={getTextContent}
      getAssetURL={getAssetURL}
      selectedIntroIndex={selectedIntroIndex}
      selectedTreatmentIndex={selectedTreatmentIndex}
      onBack={onBack}
      onRefresh={onRefresh}
      contentVersion={contentVersion}
      onTreatmentIndexChange={onTreatmentIndexChange}
      onIntroIndexChange={onIntroIndexChange}
    />
  );
}
