/**
 * Test wrapper that renders a Stage with a survey element and a mock
 * renderSurvey slot. The mock survey has a "Complete Survey" button
 * that calls onComplete with test results.
 */
import React, { useState } from "react";
import {
  StagebookProvider,
  type StagebookContext,
} from "../StagebookProvider.js";
import { Stage, type StageConfig } from "../Stage.js";

const mockSurveyResults = {
  result: { normAgreeableness: 0.82, normExtraversion: 0.65 },
  responses: { q1: "agree", q2: "neutral" },
};

export function MockSurveyStage() {
  const [savedEntries, setSavedEntries] = useState<
    Array<{ key: string; value: unknown }>
  >([]);
  const [stageSubmitted, setStageSubmitted] = useState(false);

  const stage: StageConfig = {
    name: "SurveyStage",
    duration: 120,
    elements: [
      { type: "survey", surveyName: "TIPI", name: "preTIPI" },
      { type: "submitButton" },
    ],
  };

  const mockContext: StagebookContext = {
    get: () => [],
    save: (key: string, value: unknown) => {
      setSavedEntries((prev) => [...prev, { key, value }]);
    },
    getElapsedTime: () => 0,
    submit: () => {},
    getAssetURL: (path: string) => `https://mock-cdn.test/${path}`,
    getTextContent: () =>
      // After #243 noResponse files are two-section.
      Promise.resolve("---\nname: mock\ntype: noResponse\n---\nMock\n"),
    progressLabel: "game_0_SurveyStage",
    playerId: "test-player",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
    renderSurvey: ({ surveyName, onComplete }) => (
      <div
        data-testid="mock-survey"
        style={{
          padding: "1.5rem",
          border: "2px dashed var(--stagebook-border, #d1d5db)",
          borderRadius: "0.5rem",
          maxWidth: "32rem",
        }}
      >
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
          Mock Survey: <strong>{surveyName}</strong>
        </h3>
        <div
          style={{
            marginBottom: "0.75rem",
            fontSize: "0.875rem",
            color: "#4b5563",
          }}
        >
          <p style={{ margin: "0 0 0.5rem 0" }}>
            Q1: I see myself as extraverted, enthusiastic
          </p>
          <div style={{ display: "flex", gap: "0.75rem", marginLeft: "1rem" }}>
            {["Disagree", "Neutral", "Agree"].map((label) => (
              <label
                key={label}
                style={{ fontSize: "0.8rem", color: "#6b7280" }}
              >
                <input type="radio" name="q1" disabled /> {label}
              </label>
            ))}
          </div>
        </div>
        <div
          style={{
            marginBottom: "1rem",
            fontSize: "0.875rem",
            color: "#4b5563",
          }}
        >
          <p style={{ margin: "0 0 0.5rem 0" }}>
            Q2: I see myself as sympathetic, warm
          </p>
          <div style={{ display: "flex", gap: "0.75rem", marginLeft: "1rem" }}>
            {["Disagree", "Neutral", "Agree"].map((label) => (
              <label
                key={label}
                style={{ fontSize: "0.8rem", color: "#6b7280" }}
              >
                <input type="radio" name="q2" disabled /> {label}
              </label>
            ))}
          </div>
        </div>
        <p
          style={{
            fontSize: "0.75rem",
            color: "#9ca3af",
            marginBottom: "0.75rem",
          }}
        >
          (Mock survey — click below to simulate completion with pre-set
          results)
        </p>
        <button
          data-testid="complete-survey-btn"
          onClick={() => onComplete(mockSurveyResults)}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "var(--stagebook-primary, #2563eb)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            cursor: "pointer",
            fontSize: "0.875rem",
          }}
        >
          Complete Survey
        </button>
      </div>
    ),
  };

  return (
    <div>
      <StagebookProvider value={mockContext}>
        <Stage stage={stage} onSubmit={() => setStageSubmitted(true)} />
      </StagebookProvider>
      {/* Hidden elements for test assertions */}
      <div data-testid="stage-submitted" style={{ display: "none" }}>
        {stageSubmitted ? "true" : "false"}
      </div>
      <div data-testid="saved-entries" style={{ display: "none" }}>
        {JSON.stringify(savedEntries)}
      </div>
    </div>
  );
}
