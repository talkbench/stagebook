import { useState } from "react";
import type { ExampleEntry } from "../lib/exampleCatalog";

interface LandingPageProps {
  onLoad: (url: string) => void;
  examples: ExampleEntry[];
  onLoadExample: (entry: ExampleEntry) => void;
}

export function LandingPage({
  onLoad,
  examples,
  onLoadExample,
}: LandingPageProps) {
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onLoad(url.trim());
    }
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Stagebook Viewer</h1>
        <p style={subtitleStyle}>
          Walk through a study from the participant's perspective.
        </p>

        <form onSubmit={handleSubmit} style={formStyle}>
          <label htmlFor="url-input" style={labelStyle}>
            GitHub URL to a treatment YAML file
          </label>
          <input
            id="url-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/org/repo/blob/main/treatments/study.yaml"
            style={inputStyle}
          />
          <button type="submit" disabled={!url.trim()} style={buttonStyle}>
            Load study
          </button>
        </form>

        <p style={hintStyle}>
          Paste a link to any treatment YAML file hosted on GitHub. The viewer
          fetches it directly — no backend needed.
        </p>

        {examples.length > 0 && (
          <section aria-label="Examples" style={examplesSectionStyle}>
            <h2 style={examplesHeadingStyle}>Or try an example</h2>
            <ul style={examplesListStyle}>
              {examples.map((example) => (
                <li key={example.id}>
                  <button
                    type="button"
                    onClick={() => onLoadExample(example)}
                    style={exampleCardStyle}
                  >
                    <span style={exampleTitleStyle}>{example.title}</span>
                    {example.notes && (
                      <span style={exampleNotesStyle}>{example.notes}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
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
  fontSize: "1.5rem",
  fontWeight: 700,
  color: "#1f2937",
  margin: 0,
};

const subtitleStyle: React.CSSProperties = {
  color: "#6b7280",
  marginTop: "0.5rem",
  fontSize: "0.875rem",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  marginTop: "1.5rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "#374151",
};

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: "0.375rem",
  border: "1px solid #d1d5db",
  fontSize: "0.875rem",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: "0.375rem",
  border: "none",
  // Accent token (fallback = blue-600) so app chrome tracks the palette.
  backgroundColor: "var(--stagebook-primary, #2563eb)",
  color: "white",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: 500,
  marginTop: "0.5rem",
};

const hintStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#9ca3af",
  marginTop: "1.5rem",
  lineHeight: 1.5,
};

const examplesSectionStyle: React.CSSProperties = {
  marginTop: "2rem",
  paddingTop: "1.5rem",
  borderTop: "1px solid #e5e7eb",
};

const examplesHeadingStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "#374151",
  margin: "0 0 0.75rem 0",
};

const examplesListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const exampleCardStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "0.75rem 1rem",
  borderRadius: "0.375rem",
  border: "1px solid #d1d5db",
  backgroundColor: "white",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  font: "inherit",
};

const exampleTitleStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "#1f2937",
};

const exampleNotesStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#6b7280",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};
