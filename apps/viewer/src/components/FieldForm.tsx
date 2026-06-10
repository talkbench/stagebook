import { useState } from "react";
import type { PostFillIssue } from "../lib/previewResolution";

interface FieldFormProps {
  unresolvedFields: string[];
  onSubmit: (values: Record<string, string>) => void;
  /** Pre-populate inputs, e.g. with previously-submitted values when
   * the form re-shows after a post-fill validation failure (#474). */
  initialValues?: Record<string, string>;
  /** Post-fill validation errors to display in a summary panel. */
  errors?: PostFillIssue[];
}

export function FieldForm({
  unresolvedFields,
  onSubmit,
  initialValues,
  errors,
}: FieldFormProps) {
  const [values, setValues] = useState<Record<string, string>>({
    ...Object.fromEntries(unresolvedFields.map((f) => [f, ""])),
    ...initialValues,
  });

  const allFilled = unresolvedFields.every((f) => values[f]?.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (allFilled) onSubmit(values);
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Fill in remaining fields</h1>
        <p style={subtitleStyle}>
          These template fields weren't resolved during expansion. Provide
          values to continue.
        </p>

        {errors && errors.length > 0 && (
          <div style={errorPanelStyle} role="alert">
            <strong style={errorTitleStyle}>Post-fill validation failed</strong>
            <p style={errorSubtitleStyle}>
              The values below expanded successfully, but the filled treatment
              contains issues that would surface to participants. Adjust the
              values and resubmit.
            </p>
            <ul style={errorListStyle}>
              {errors.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  <code>{issue.path}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} style={formStyle}>
          {unresolvedFields.map((field) => (
            <div
              key={field}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <label htmlFor={`field-${field}`} style={labelStyle}>
                {"${" + field + "}"}
              </label>
              <input
                id={`field-${field}`}
                type="text"
                value={values[field] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field]: e.target.value }))
                }
                style={inputStyle}
              />
            </div>
          ))}
          <button type="submit" disabled={!allFilled} style={buttonStyle}>
            Continue
          </button>
        </form>
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

const subtitleStyle: React.CSSProperties = {
  color: "#6b7280",
  marginTop: "0.5rem",
  fontSize: "0.875rem",
};

const errorPanelStyle: React.CSSProperties = {
  marginTop: "1rem",
  padding: "0.75rem 1rem",
  borderRadius: "0.375rem",
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  fontSize: "0.875rem",
  color: "#991b1b",
};

const errorTitleStyle: React.CSSProperties = {
  fontWeight: 600,
};

const errorSubtitleStyle: React.CSSProperties = {
  margin: "0.25rem 0 0",
};

const errorListStyle: React.CSSProperties = {
  margin: "0.5rem 0 0",
  paddingLeft: "1.25rem",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  marginTop: "1.5rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "#374151",
  fontFamily: "monospace",
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
  backgroundColor: "#3b82f6",
  color: "white",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: 500,
  marginTop: "0.5rem",
};
