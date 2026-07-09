import { useEffect, useMemo, useState } from "react";
import { type TreatmentFileType } from "../../schemas/index.js";
import { checkPromptLocaleConsistencyWithLoader } from "../../validate/localeConsistency.js";
import {
  computePreviewState,
  type PostFillIssue,
} from "../lib/previewResolution.js";
import { FieldForm } from "./FieldForm.js";
import { Viewer } from "./Viewer.js";

export interface PreviewHostProps {
  treatmentFile: TreatmentFileType;
  /**
   * Pre-supplied values for `${field}` placeholders (e.g. from a sidecar
   * file). Any placeholders not covered here will surface as a FieldForm.
   * Should be referentially stable (memoized) — its identity feeds the
   * expansion memo and the post-fill locale re-check, so a fresh object each
   * render would re-run both unnecessarily.
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

  // #492: re-run the prompt locale-consistency check on the FIELD-RESOLVED
  // tree. The on-load check (loader.ts) runs before host `additionalFields` /
  // FieldForm values bind, so when `locale` (or a prompt `file:` path) is a
  // deferred `${field}` it's a no-op there — this is the first point the
  // resolved tree exists. It's async (reads each prompt's frontmatter), so it
  // can't live in the sync/pure computePreviewState. Non-blocking, matching
  // the load path's treatment of locale mismatches: the preview still renders,
  // with a banner above it.
  const resolved = previewState.mode === "ready" ? previewState.resolved : null;
  const [localeIssues, setLocaleIssues] = useState<PostFillIssue[]>([]);

  useEffect(() => {
    if (resolved === null) {
      setLocaleIssues([]);
      return;
    }
    // Clear eagerly before the async re-check so a tree change (ready→ready,
    // e.g. rebinding a field) never leaves the previous tree's mismatch
    // messages rendered above the new tree for a tick.
    setLocaleIssues([]);
    let cancelled = false;
    void (async () => {
      const mismatches = await checkPromptLocaleConsistencyWithLoader({
        fileObj: resolved,
        loadPrompt: async (relPath) => {
          try {
            return await getTextContent(relPath);
          } catch {
            // Unreadable prompt — a different error class with its own
            // reporting; the locale check skips it (treats as unloaded).
            return null;
          }
        },
      });
      if (!cancelled) {
        setLocaleIssues(
          mismatches.map((m) => ({ path: m.promptFile, message: m.message })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved, getTextContent]);

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

  const localeBanner =
    localeIssues.length > 0 ? (
      <div
        data-testid="locale-mismatch-banner"
        role="alert"
        style={localeBannerStyle}
      >
        <strong style={localeBannerTitleStyle}>
          {localeIssues.length === 1
            ? "Prompt locale mismatch"
            : `${localeIssues.length} prompt locale mismatches`}
        </strong>
        <ul style={localeBannerListStyle}>
          {localeIssues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      </div>
    ) : undefined;

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
      notice={localeBanner}
    />
  );
}

// Non-blocking notice rendered inside the Viewer (below its header, via the
// `notice` prop) when the field-resolved tree references a prompt whose locale
// doesn't match its container's (#492).
const localeBannerStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  borderBottom: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  fontFamily: "system-ui, sans-serif",
  fontSize: "0.875rem",
};

const localeBannerTitleStyle: React.CSSProperties = {
  fontWeight: 600,
};

const localeBannerListStyle: React.CSSProperties = {
  margin: "0.25rem 0 0",
  paddingLeft: "1.25rem",
};
