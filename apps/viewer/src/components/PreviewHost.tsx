import { useMemo, useState } from "react";
import type { TreatmentFileType } from "stagebook";
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

  const { resolved, unresolvedFields } = useMemo(() => {
    const merged = {
      ...(additionalFields ?? {}),
      ...(userValues ?? {}),
    };
    const { result, unresolvedFields } = expandTreatmentFile(
      treatmentFile,
      Object.keys(merged).length > 0 ? merged : undefined,
    );
    return { resolved: result, unresolvedFields };
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
