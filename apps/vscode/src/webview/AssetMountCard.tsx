import React from "react";

// --- Asset-mount picker card (#192, #813) ---
//
// A notice listing `asset://<prefix>/…` mounts. Each unmapped prefix gets a
// "Choose folder…" row; each mapped one shows its folder and a "Change…" row,
// so a wrong pick can be fixed without the Configure Asset Folders command.
// Both buttons ask the extension to open a folder picker for that prefix.
//
// The live preview shows it (via PreviewHost's `hostNotice`) only while a
// prefix is unmapped, without mapped rows; the preview keeps rendering
// (unmapped assets show the #191 placeholder) rather than gating on the pick.
// The FieldForm gate shows it (via `hostFormNotice`) with mapped rows too:
// a pick outside the workspace reloads the webview back to that form.
//
// vscode-webview-only: local mounting is meaningless in the browser viewer or
// TalkBench, so this lives here, not in the shared harness. Colors match the
// preview's light chrome (cf. the locale-mismatch banner) rather than the
// editor theme, since the preview emulates the participant experience.
export function AssetMountCard({
  unmapped,
  mounted = {},
  onPick,
  inline = false,
}: {
  unmapped: string[];
  /** prefix → local folder for each mapped prefix (#813). */
  mounted?: Record<string, string>;
  onPick: (prefix: string) => void;
  /** Boxed for a host card (the FieldForm) rather than a full-width banner. */
  inline?: boolean;
}) {
  const mountedEntries = Object.entries(mounted);
  if (unmapped.length === 0 && mountedEntries.length === 0) return null;

  return (
    <div
      data-testid="asset-mount-card"
      role="region"
      aria-label="Asset folders"
      style={inline ? cardInlineStyle : cardWrapStyle}
    >
      <strong style={cardTitleStyle}>
        {unmapped.length === 0
          ? "Asset folders"
          : unmapped.length === 1
            ? "1 asset folder isn't mapped"
            : `${unmapped.length} asset folders aren't mapped`}
      </strong>
      <p style={cardSubtitleStyle}>
        These <code style={codeChipStyle}>asset://</code> references load from
        folders on your machine
        {unmapped.length > 0
          ? " — until a prefix has one, its media shows a placeholder"
          : ""}
        . Choose the folder that holds the files after the prefix:{" "}
        <code style={codeChipStyle}>asset://media/a/b.mp4</code> loads{" "}
        <code style={codeChipStyle}>a/b.mp4</code> from the folder chosen for{" "}
        <code style={codeChipStyle}>media</code>. Your choices are remembered
        for this workspace and are never written to the study.
      </p>
      <ul style={cardListStyle}>
        {unmapped.map((prefix) => (
          <li key={prefix} style={cardRowStyle}>
            <code style={cardPrefixStyle}>asset://{prefix}/</code>
            <button
              type="button"
              style={cardButtonStyle}
              aria-label={`Choose folder for asset://${prefix}/`}
              onClick={() => onPick(prefix)}
            >
              Choose folder…
            </button>
          </li>
        ))}
        {mountedEntries.map(([prefix, dir]) => (
          <li key={prefix} style={cardRowStyle}>
            <span style={cardMountStyle}>
              <code style={cardPrefixStyle}>asset://{prefix}/</code>
              <span style={cardDirStyle}>{dir}</span>
            </span>
            <button
              type="button"
              style={cardSecondaryButtonStyle}
              aria-label={`Change folder for asset://${prefix}/`}
              onClick={() => onPick(prefix)}
            >
              Change…
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const cardWrapStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  borderBottom: "1px solid #bfdbfe",
  backgroundColor: "#eff6ff",
  color: "#1e3a8a",
  fontFamily: "system-ui, sans-serif",
  fontSize: "0.875rem",
};

const cardInlineStyle: React.CSSProperties = {
  ...cardWrapStyle,
  borderBottom: undefined,
  border: "1px solid #bfdbfe",
  borderRadius: "0.375rem",
  marginTop: "1rem",
};

const cardTitleStyle: React.CSSProperties = {
  fontWeight: 600,
};

const cardSubtitleStyle: React.CSSProperties = {
  margin: "0.25rem 0 0.5rem",
  color: "#1e40af",
};

const cardListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const cardRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  flexWrap: "wrap",
};

// Shrinks (with the path wrapping inside) so the button keeps its place on
// the right; the row only wraps once it's narrower than the basis.
const cardMountStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.125rem",
  flex: "1 1 12rem",
  minWidth: 0,
};

// Local paths run long; let them break anywhere rather than overflow the card.
const cardDirStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#1e40af",
  overflowWrap: "anywhere",
};

// `<code>` chips in the webview's own chrome. The extension used to style bare
// `<code>` globally; that rule was removed with the hand-copied CSS (#560), and
// styles.css has no bare `code` rule (library code styling is inline in the
// Markdown component), so this chrome must style its own chips.
const codeChipStyle: React.CSSProperties = {
  fontFamily: "monospace",
  backgroundColor: "rgba(0, 0, 0, 0.06)",
  // Inherit the card's text color rather than VS Code's amber `code` default.
  color: "inherit",
  padding: "0.125rem 0.25rem",
  borderRadius: "0.25rem",
};

const cardPrefixStyle: React.CSSProperties = {
  ...codeChipStyle,
  fontSize: "0.8125rem",
  alignSelf: "flex-start",
};

const cardButtonStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  borderRadius: "0.375rem",
  border: "none",
  // Accent token (fallback = blue-600) so this webview chrome tracks the
  // palette instead of pinning the retired blue-500.
  backgroundColor: "var(--stagebook-primary, #2563eb)",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: "0.8125rem",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

// A mapped prefix already works, so its button is quieter than the
// "Choose folder…" call to action.
const cardSecondaryButtonStyle: React.CSSProperties = {
  ...cardButtonStyle,
  border: "1px solid var(--stagebook-primary, #2563eb)",
  backgroundColor: "#ffffff",
  color: "var(--stagebook-primary, #2563eb)",
};
