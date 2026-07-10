import { useEffect, useRef } from "react";

interface HotkeyHelpProps {
  open: boolean;
  onClose: () => void;
}

// Researcher hotkeys, shown in the cheatsheet. Kept in sync with the routing
// in ../lib/hotkeys.ts. `⌥` renders as the Option glyph; on Windows/Linux it
// is the Alt key (noted in the footnote).
const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "⌥ ← / ⌥ →", action: "Previous / next step" },
  { keys: "⌥ ↑ / ⌥ ↓", action: "Previous / next treatment" },
  { keys: "⌥ P", action: "Focus the part picker (type to jump)" },
  { keys: "⌥ 0 – ⌥ 9", action: "Jump to player position" },
  { keys: "⌥ K", action: "Play / pause the timer" },
  { keys: "⌥ /", action: "Toggle this cheatsheet" },
];

/**
 * The `Alt+/` shortcut cheatsheet. Rendered inside the viewer root; the
 * backdrop is `position: absolute`, so it dims only this viewer (the root is a
 * containing block), not the whole host page when embedded. Escape or a
 * backdrop click dismisses it.
 */
export function HotkeyHelp({ open, onClose }: HotkeyHelpProps) {
  // Read onClose through a ref so the Escape listener subscribes once per open
  // (not on every parent re-render — the viewer re-renders ~20×/s during timer
  // playback, and onClose is typically a fresh inline closure each time).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Consume it: without focus moved into the dialog, Escape would also
        // reach the previously focused study widget (e.g. a Timeline with an
        // active selection deselects on Escape) if we let it propagate.
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    // Capture phase so this runs before a focused study widget's own Escape
    // handler, which may stopPropagation() and otherwise leave the cheatsheet
    // stuck open.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  return (
    <div style={backdropStyle} onClick={onClose} data-testid="hotkey-help">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={titleRowStyle}>
          <span style={titleStyle}>Keyboard shortcuts</span>
          <button aria-label="Close" onClick={onClose} style={closeStyle}>
            &times;
          </button>
        </div>
        <table style={tableStyle}>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td style={keysCellStyle}>{s.keys}</td>
                <td style={actionCellStyle}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={footnoteStyle}>
          Hold <kbd style={kbdStyle}>⌥ Option</kbd> with each key — on
          Windows/Linux that&rsquo;s the <kbd style={kbdStyle}>Alt</kbd> key.
        </p>
      </div>
    </div>
  );
}

// --- Styles (match the viewer's light chrome) ---

const backdropStyle: React.CSSProperties = {
  // Absolute (not fixed) so it's scoped to the positioned viewer root — dims
  // this viewer only, staying polite when embedded in a larger host page.
  position: "absolute",
  inset: 0,
  backgroundColor: "rgba(17, 24, 39, 0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

const panelStyle: React.CSSProperties = {
  backgroundColor: "white",
  borderRadius: "0.5rem",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
  padding: "1rem 1.25rem",
  minWidth: "20rem",
  maxWidth: "26rem",
};

const titleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "0.75rem",
};

const titleStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "#1f2937",
};

const closeStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "1.25rem",
  lineHeight: 1,
  color: "#6b7280",
  padding: "0 0.25rem",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.8125rem",
};

const keysCellStyle: React.CSSProperties = {
  padding: "0.25rem 0.75rem 0.25rem 0",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  color: "#111827",
  fontWeight: 600,
};

const actionCellStyle: React.CSSProperties = {
  padding: "0.25rem 0",
  color: "#4b5563",
  width: "100%",
};

const footnoteStyle: React.CSSProperties = {
  marginTop: "0.75rem",
  fontSize: "0.6875rem",
  color: "#6b7280",
  lineHeight: 1.5,
};

const kbdStyle: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.625rem",
  fontWeight: 600,
  border: "1px solid #d1d5db",
  borderRadius: "0.1875rem",
  padding: "0.0625rem 0.25rem",
  backgroundColor: "#f9fafb",
  color: "#374151",
};
