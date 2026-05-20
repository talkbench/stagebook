import { useMemo, useState } from "react";
import {
  validateResolvedTreatmentFile,
  type TreatmentFileType,
} from "stagebook";
import { expandTreatmentFile } from "../lib/expandTreatmentFile";
import { FieldForm } from "./FieldForm";
import { Viewer } from "./Viewer";

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
   * are resolved purely from `additionalFields`.
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

  const { resolved, unresolvedFields, resolvedIssues } = useMemo(() => {
    const merged = {
      ...(additionalFields ?? {}),
      ...(userValues ?? {}),
    };
    const { result, unresolvedFields } = expandTreatmentFile(
      treatmentFile,
      Object.keys(merged).length > 0 ? merged : undefined,
    );
    // Post-fill validation (#398): if every `${field}` placeholder
    // was bound (unresolvedFields is empty), run the resolved-schema
    // check on the filled tree. Catches issues that the relaxed
    // pre-fill schema deferred — e.g. a `prompt.file` that doesn't
    // end in `.prompt.md` after the host supplied the value. Skipped
    // while there are still unresolved fields because the
    // strict-mode validator would re-report every leak as an issue
    // and bury the actual "we need bindings" path under noise.
    const resolvedIssues =
      unresolvedFields.length === 0
        ? validateResolvedTreatmentFile(result).issues
        : [];
    return { resolved: result, unresolvedFields, resolvedIssues };
  }, [treatmentFile, additionalFields, userValues]);

  if (unresolvedFields.length > 0) {
    return (
      <FieldForm
        unresolvedFields={unresolvedFields}
        onSubmit={(values) => {
          setUserValues(values);
          onFieldsResolved?.(values);
        }}
      />
    );
  }

  if (resolvedIssues.length > 0) {
    // After-fill validation surfaced a contract violation that
    // would otherwise reach the participant as a broken page. Show
    // an inline error panel rather than rendering Viewer. Matches
    // the shape that `TreatmentValidationError` produces for
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
          {resolvedIssues.map((issue, i) => (
            <li key={i}>
              <code>{issue.path.join(".") || "(root)"}</code>: {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <Viewer
      treatmentFile={resolved}
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
