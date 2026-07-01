import { useState } from "react";
import {
  sortDiagnostics,
  summarizeDiagnostics,
  type ViewerDiagnostic,
} from "../lib/diagnostics";

/**
 * Format a count as "N error(s)" / "N warning(s)", omitting zero categories.
 * "2 errors, 1 warning" · "1 warning" · "3 errors".
 */
/**
 * A content-derived key so rows keep their identity when the list re-sorts
 * (index keys would let React reuse the wrong row across a reorder). Position +
 * severity + message is effectively unique; truly identical diagnostics are
 * interchangeable, so a rare collision is harmless.
 */
function diagnosticKey(d: ViewerDiagnostic): string {
  const pos = d.range ? `${d.range.startLine}:${d.range.startCol}` : "-";
  return `${d.severity}|${d.file}|${pos}|${d.message}`;
}

function summaryLabel(errors: number, warnings: number): string {
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warnings > 0) {
    parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  }
  return parts.join(", ");
}

/**
 * The ordered rows of a diagnostics list. Exported so the unrenderable-file
 * placeholder can reuse the same rendering as the drawer.
 *
 * Positions (`Ln:Col`) are 1-based for display (library ranges are 0-based,
 * LSP convention). They refer to the entry file's raw source — the same lines
 * the VS Code extension's Problems panel points at. The viewer shows no source,
 * so they're informational; the message's field path (e.g.
 * `treatments[0].gameStages[1]`) is the primary locator.
 */
export function DiagnosticsList({
  diagnostics,
}: {
  diagnostics: readonly ViewerDiagnostic[];
}) {
  const sorted = sortDiagnostics(diagnostics);
  return (
    <ul style={listStyle}>
      {sorted.map((d) => (
        <li key={diagnosticKey(d)} style={rowStyle(d.severity)}>
          <span style={iconStyle(d.severity)} aria-hidden>
            {d.severity === "error" ? "✕" : "⚠"}
          </span>
          <div style={rowBodyStyle}>
            <span>{d.message}</span>
            <span style={metaStyle}>
              {d.file}
              {d.range
                ? `:${d.range.startLine + 1}:${d.range.startCol + 1}`
                : ""}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A collapsible drawer pinned to the bottom of the viewport that surfaces
 * validation diagnostics on load (#440). Renders nothing when there are no
 * diagnostics (silent success). Persists while diagnostics are present —
 * collapsing hides the list, not the drawer.
 */
export function DiagnosticsDrawer({
  diagnostics,
}: {
  diagnostics: readonly ViewerDiagnostic[];
}) {
  const [expanded, setExpanded] = useState(true);
  if (diagnostics.length === 0) return null;

  const { errors, warnings } = summarizeDiagnostics(diagnostics);
  const hasErrors = errors > 0;

  return (
    <div style={drawerStyle}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={headerStyle(hasErrors)}
      >
        <span style={iconStyle(hasErrors ? "error" : "warning")} aria-hidden>
          {hasErrors ? "✕" : "⚠"}
        </span>
        <span style={{ fontWeight: 600 }}>
          {summaryLabel(errors, warnings)}
        </span>
        <span style={{ marginLeft: "auto" }} aria-hidden>
          {expanded ? "▾" : "▴"}
        </span>
      </button>
      {expanded && (
        <div style={bodyStyle}>
          <DiagnosticsList diagnostics={diagnostics} />
        </div>
      )}
    </div>
  );
}

const drawerStyle: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 50,
  backgroundColor: "white",
  borderTop: "1px solid #e5e7eb",
  boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.06)",
  fontSize: "0.8125rem",
};

const headerStyle = (hasErrors: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  padding: "0.5rem 0.875rem",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  backgroundColor: hasErrors ? "#fef2f2" : "#fffbeb",
  color: hasErrors ? "#991b1b" : "#92400e",
});

const bodyStyle: React.CSSProperties = {
  maxHeight: "40vh",
  overflowY: "auto",
  padding: "0.5rem 0.875rem",
  borderTop: "1px solid #f3f4f6",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
};

const rowStyle = (
  severity: ViewerDiagnostic["severity"],
): React.CSSProperties => ({
  display: "flex",
  gap: "0.5rem",
  padding: "0.375rem 0.5rem",
  borderRadius: "0.375rem",
  backgroundColor: severity === "error" ? "#fef2f2" : "#fffbeb",
  border: `1px solid ${severity === "error" ? "#fecaca" : "#fde68a"}`,
  color: "#374151",
});

const rowBodyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.125rem",
  minWidth: 0,
};

const iconStyle = (
  severity: ViewerDiagnostic["severity"],
): React.CSSProperties => ({
  flexShrink: 0,
  color: severity === "error" ? "#dc2626" : "#d97706",
  fontWeight: 700,
});

const metaStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "#9ca3af",
  fontFamily: "monospace",
};
