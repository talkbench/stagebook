import type { TreatmentFileType } from "stagebook";

interface TreatmentPickerProps {
  treatmentFile: TreatmentFileType;
  onSelect: (introIndex: number, treatmentIndex: number) => void;
}

export function TreatmentPicker({
  treatmentFile,
  onSelect,
}: TreatmentPickerProps) {
  // `introSequences` is optional in the schema (a treatments-only file is
  // valid); normalize to [] so the .length/.map below never throw.
  const introSequences = treatmentFile.introSequences ?? [];
  const { treatments } = treatmentFile;
  const multipleIntros = introSequences.length > 1;
  const multipleTreatments = treatments.length > 1;

  // If only one dimension needs selection, auto-select the other
  const handleTreatmentClick = (treatmentIndex: number) => {
    if (multipleIntros) return; // need intro selection too — handled below
    onSelect(0, treatmentIndex);
  };

  // For the rare case of multiple intros + multiple treatments,
  // show both lists with a two-step selection. For now, keep it
  // simple: single combined selection.
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Select a configuration</h1>

        {multipleTreatments && (
          <>
            <h2 style={sectionStyle}>Treatments</h2>
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
                  <button
                    key={t.name}
                    onClick={() => handleTreatmentClick(i)}
                    style={optionStyle}
                  >
                    <span style={optionNameStyle}>{t.name}</span>
                    <span style={optionDetailStyle}>
                      {t.playerCount} player{t.playerCount !== 1 ? "s" : ""},{" "}
                      {t.gameStages.length} stage
                      {t.gameStages.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                ),
              )}
            </div>
          </>
        )}

        {multipleIntros && (
          <>
            <h2 style={sectionStyle}>Intro Sequences</h2>
            <div style={listStyle}>
              {introSequences.map(
                (intro: { name: string; introSteps: unknown[] }, i: number) => (
                  <button
                    key={intro.name}
                    onClick={() => onSelect(i, 0)}
                    style={optionStyle}
                  >
                    <span style={optionNameStyle}>{intro.name}</span>
                    <span style={optionDetailStyle}>
                      {intro.introSteps.length} step
                      {intro.introSteps.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  backgroundColor: "#f9fafb",
};

const cardStyle: React.CSSProperties = {
  maxWidth: "32rem",
  width: "100%",
  padding: "2rem",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.25rem",
  fontWeight: 700,
  color: "#1f2937",
  margin: 0,
};

const sectionStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "#374151",
  marginTop: "1.5rem",
  marginBottom: "0.5rem",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const optionStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.75rem 1rem",
  borderRadius: "0.375rem",
  border: "1px solid #e5e7eb",
  backgroundColor: "white",
  cursor: "pointer",
  textAlign: "left",
};

const optionNameStyle: React.CSSProperties = {
  fontWeight: 500,
  color: "#1f2937",
  fontSize: "0.875rem",
};

const optionDetailStyle: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: "0.75rem",
};
