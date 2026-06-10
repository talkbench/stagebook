/**
 * Test wrapper for Qualtrics that tracks save calls and completion.
 * Shows visible status indicators for the Playwright UI preview.
 */
import React, { useState } from "react";
import { Qualtrics } from "../elements/Qualtrics.js";

export interface MockQualtricsProps {
  url: string;
  resolvedParams?: Array<{ key: string; value: string }>;
  stableParticipantId?: string;
  sampleId?: string;
}

export function MockQualtrics({
  url,
  resolvedParams = [],
  stableParticipantId,
  sampleId,
}: MockQualtricsProps) {
  const [savedData, setSavedData] = useState<{
    key: string;
    value: unknown;
  } | null>(null);
  const [completed, setCompleted] = useState(false);

  return (
    <div style={{ padding: "1rem" }}>
      {/* Visible status panel */}
      <div
        style={{
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          borderRadius: "0.375rem",
          backgroundColor: completed ? "#dcfce7" : "#fef3c7",
          border: `1px solid ${completed ? "#16a34a" : "#d97706"}`,
          fontSize: "0.875rem",
        }}
      >
        <strong>Qualtrics Test Status</strong>
        <div style={{ marginTop: "0.25rem" }}>
          Completion:{" "}
          <span style={{ fontWeight: 600 }}>
            {completed ? "✓ Complete" : "⏳ Waiting for QualtricsEOS message"}
          </span>
        </div>
        {savedData && (
          <div style={{ marginTop: "0.25rem" }}>
            Saved: <code>{savedData.key}</code> →{" "}
            <code>{JSON.stringify(savedData.value)}</code>
          </div>
        )}
      </div>

      {/* The actual Qualtrics component (iframe will try to load the URL) */}
      <Qualtrics
        url={url}
        resolvedParams={resolvedParams}
        stableParticipantId={stableParticipantId}
        sampleId={sampleId}
        save={(key, value) => setSavedData({ key, value })}
        onComplete={() => setCompleted(true)}
      />

      {/* Hidden elements for programmatic test assertions */}
      <div data-testid="qualtrics-completed" style={{ display: "none" }}>
        {completed ? "true" : "false"}
      </div>
      <div data-testid="qualtrics-saved-key" style={{ display: "none" }}>
        {savedData?.key ?? ""}
      </div>
      <div data-testid="qualtrics-saved-value" style={{ display: "none" }}>
        {savedData ? JSON.stringify(savedData.value) : ""}
      </div>
    </div>
  );
}
