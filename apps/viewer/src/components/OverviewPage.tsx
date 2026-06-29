import { useState } from "react";
import type { TreatmentFileType } from "stagebook";
import { Markdown } from "stagebook/components";

export interface OverviewPageProps {
  treatmentFile: TreatmentFileType;
  /** README content, or null if no README was found. */
  readmeContent: string | null;
  onSelect: (introIndex: number, treatmentIndex: number) => void;
  onBack?: () => void;
}

/**
 * Study overview page. Renders the sibling `README.md` (left column) and
 * the treatment picker (right column) on wide screens; stacks vertically
 * on narrow ones. When there is no README, collapses to a single-column
 * picker. See #159.
 */
export function OverviewPage({
  treatmentFile,
  readmeContent,
  onSelect,
  onBack,
}: OverviewPageProps) {
  // `introSequences` is optional in the schema (a treatments-only file is
  // valid); normalize to [] so the .length/.map below never throw.
  const introSequences = treatmentFile.introSequences ?? [];
  const { treatments } = treatmentFile;
  const multipleIntros = introSequences.length > 1;
  const multipleTreatments = treatments.length > 1;

  const [selectedIntro, setSelectedIntro] = useState(0);
  const [selectedTreatment, setSelectedTreatment] = useState(0);

  const hasReadme = readmeContent !== null;

  return (
    <div style={containerStyle}>
      {onBack && (
        <button aria-label="Back" onClick={onBack} style={backButtonStyle}>
          &larr; Back
        </button>
      )}
      <div style={{ ...layoutStyle, ...(hasReadme ? {} : oneColLayoutStyle) }}>
        {hasReadme && (
          <section style={readmeColStyle} data-testid="overview-readme">
            <Markdown text={readmeContent} />
          </section>
        )}
        <section
          style={pickerColStyle}
          data-testid="overview-picker"
          aria-label="Select a configuration"
        >
          <h1 style={titleStyle}>
            {multipleTreatments || multipleIntros
              ? "Select a configuration"
              : "Ready to view"}
          </h1>

          {multipleTreatments && (
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>Treatments</legend>
              <div style={listStyle}>
                {treatments.map(
                  (
                    t: {
                      name: string;
                      playerCount: number;
                      gameStages: unknown[];
                    },
                    i: number,
                  ) => (
                    <label
                      key={t.name}
                      style={optionStyle(i === selectedTreatment)}
                    >
                      <input
                        type="radio"
                        name="treatment"
                        checked={i === selectedTreatment}
                        onChange={() => setSelectedTreatment(i)}
                        style={radioStyle}
                      />
                      <span style={optionBodyStyle}>
                        <span style={optionNameStyle}>{t.name}</span>
                        <span style={optionDetailStyle}>
                          {t.playerCount} player
                          {t.playerCount !== 1 ? "s" : ""},{" "}
                          {t.gameStages.length} stage
                          {t.gameStages.length !== 1 ? "s" : ""}
                        </span>
                      </span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          )}

          {multipleIntros && (
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>Intro sequence</legend>
              <div style={listStyle}>
                {introSequences.map(
                  (
                    intro: { name: string; introSteps: unknown[] },
                    i: number,
                  ) => (
                    <label
                      key={intro.name}
                      style={optionStyle(i === selectedIntro)}
                    >
                      <input
                        type="radio"
                        name="intro"
                        checked={i === selectedIntro}
                        onChange={() => setSelectedIntro(i)}
                        style={radioStyle}
                      />
                      <span style={optionBodyStyle}>
                        <span style={optionNameStyle}>{intro.name}</span>
                        <span style={optionDetailStyle}>
                          {intro.introSteps.length} step
                          {intro.introSteps.length !== 1 ? "s" : ""}
                        </span>
                      </span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          )}

          <button
            onClick={() => onSelect(selectedIntro, selectedTreatment)}
            style={viewButtonStyle}
            data-testid="overview-view-button"
          >
            View &rarr;
          </button>
        </section>
      </div>
    </div>
  );
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#f9fafb",
  padding: "2rem",
  boxSizing: "border-box",
};

const layoutStyle: React.CSSProperties = {
  maxWidth: "72rem",
  margin: "0 auto",
  display: "flex",
  gap: "2rem",
  flexWrap: "wrap",
  alignItems: "flex-start",
};

const oneColLayoutStyle: React.CSSProperties = {
  maxWidth: "32rem",
  justifyContent: "center",
};

const readmeColStyle: React.CSSProperties = {
  flex: "2 1 24rem",
  minWidth: 0,
  padding: "1.5rem",
  backgroundColor: "white",
  borderRadius: "0.5rem",
  border: "1px solid #e5e7eb",
};

const pickerColStyle: React.CSSProperties = {
  flex: "1 1 20rem",
  minWidth: 0,
  padding: "1.5rem",
  backgroundColor: "white",
  borderRadius: "0.5rem",
  border: "1px solid #e5e7eb",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.25rem",
  fontWeight: 700,
  color: "#1f2937",
  margin: 0,
};

const fieldsetStyle: React.CSSProperties = {
  border: "none",
  margin: 0,
  padding: 0,
};

const legendStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "#374151",
  marginBottom: "0.5rem",
  padding: 0,
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
};

const optionStyle = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "flex-start",
  gap: "0.625rem",
  padding: "0.625rem 0.75rem",
  borderRadius: "0.375rem",
  border: active ? "1px solid #3b82f6" : "1px solid #e5e7eb",
  backgroundColor: active ? "#eff6ff" : "white",
  cursor: "pointer",
});

const radioStyle: React.CSSProperties = {
  marginTop: "0.1875rem",
  cursor: "pointer",
};

const optionBodyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.125rem",
};

const optionNameStyle: React.CSSProperties = {
  fontWeight: 500,
  color: "#1f2937",
  fontSize: "0.875rem",
};

const optionDetailStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "0.75rem",
};

const viewButtonStyle: React.CSSProperties = {
  marginTop: "auto",
  alignSelf: "stretch",
  padding: "0.625rem 1rem",
  borderRadius: "0.375rem",
  border: "none",
  backgroundColor: "#3b82f6",
  color: "white",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: 500,
};

const backButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: "1rem",
  left: "1rem",
  background: "none",
  border: "none",
  color: "#6b7280",
  cursor: "pointer",
  fontSize: "0.875rem",
  padding: "0.25rem 0.5rem",
};
