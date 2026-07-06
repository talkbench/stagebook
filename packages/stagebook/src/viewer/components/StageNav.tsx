import type { ViewerStep } from "../lib/steps.js";

interface StageNavProps {
  steps: ViewerStep[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

export function StageNav({ steps, currentIndex, onSelect }: StageNavProps) {
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < steps.length - 1;

  return (
    <div style={navStyle}>
      <button
        onClick={() => onSelect(currentIndex - 1)}
        disabled={!hasPrev}
        style={arrowStyle}
        aria-label="Previous stage"
      >
        &#9664;
      </button>

      <select
        value={currentIndex}
        onChange={(e) => onSelect(Number(e.target.value))}
        style={selectStyle}
      >
        {steps.map((step) => (
          <option key={step.index} value={step.index}>
            [{step.phase}] {step.name}
          </option>
        ))}
      </select>

      <button
        onClick={() => onSelect(currentIndex + 1)}
        disabled={!hasNext}
        style={arrowStyle}
        aria-label="Next stage"
      >
        &#9654;
      </button>

      <span style={counterStyle}>
        {currentIndex + 1} / {steps.length}
      </span>
    </div>
  );
}

const navStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.25rem",
};

const arrowStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid #d1d5db",
  borderRadius: "0.25rem",
  cursor: "pointer",
  padding: "0.25rem 0.5rem",
  fontSize: "0.625rem",
  color: "#374151",
};

const selectStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  borderRadius: "0.25rem",
  border: "1px solid #d1d5db",
  fontSize: "0.75rem",
  maxWidth: "14rem",
};

const counterStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#9ca3af",
  marginLeft: "0.25rem",
};
