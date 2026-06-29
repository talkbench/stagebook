import React, { useId } from "react";
import { MIN_ZOOM, MAX_ZOOM } from "./viewport.js";
import { useMessages } from "../../StagebookProvider.js";

export interface TimelineHeaderProps {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /**
   * The minimap is rendered here (as children) when the timeline is zoomed
   * in — so the zoom controls sit right next to the minimap for visual
   * context (issue #129). When zoomLevel === 1 the parent passes null and
   * the header shows only the zoom controls.
   */
  minimap?: React.ReactNode;
}

const buttonStyle: React.CSSProperties = {
  width: "24px",
  height: "24px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--stagebook-border, #e5e7eb)",
  borderRadius: "0.25rem",
  background: "var(--stagebook-bg, #ffffff)",
  cursor: "pointer",
  fontSize: "0.875rem",
  lineHeight: 1,
  padding: 0,
  color: "inherit",
};

const disabledStyle: React.CSSProperties = {
  ...buttonStyle,
  cursor: "not-allowed",
  opacity: 0.4,
};

export function TimelineHeader({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  minimap,
}: TimelineHeaderProps) {
  const messages = useMessages();
  // Per-instance class scope for the `:focus-visible` ring on the zoom
  // buttons (#382 polish). Same useId pattern as Button / Slider /
  // ListSorter. State-dependent rules in a scoped <style> so the
  // structural inline styles above (which win specificity battles)
  // don't block them.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const btnClass = `stagebook-timeline-zoom-${safeId}`;
  return (
    <div
      data-testid="timeline-header"
      style={{
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid var(--stagebook-border, #e5e7eb)",
        userSelect: "none",
      }}
    >
      <style>{`
        .${btnClass}:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25));
        }
        .${btnClass}:not(:disabled):hover {
          background: var(--stagebook-hover-bg, #f3f4f6);
        }
      `}</style>
      {/* Zoom controls — sized to their content. (Used to be locked to the
          gutter width when the gutter held the per-track labels; the labels
          now overlay the waveform, so there's no alignment to preserve.) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
          padding: "0.25rem",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          className={btnClass}
          data-testid="timeline-zoom-out"
          onClick={onZoomOut}
          disabled={zoomLevel <= MIN_ZOOM}
          aria-label={messages.timelineZoomOut}
          // Explicit tabIndex so Safari includes the button in the
          // Tab order (default keyboard nav on macOS Safari skips
          // <button>) — see #415 / #413.
          tabIndex={zoomLevel <= MIN_ZOOM ? -1 : 0}
          style={zoomLevel <= MIN_ZOOM ? disabledStyle : buttonStyle}
        >
          −
        </button>
        <button
          type="button"
          className={btnClass}
          data-testid="timeline-zoom-in"
          onClick={onZoomIn}
          disabled={zoomLevel >= MAX_ZOOM}
          aria-label={messages.timelineZoomIn}
          tabIndex={zoomLevel >= MAX_ZOOM ? -1 : 0}
          style={zoomLevel >= MAX_ZOOM ? disabledStyle : buttonStyle}
        >
          +
        </button>
      </div>
      {/* Minimap sits alongside the zoom controls so participants see which
          region they're zooming relative to. Null when zoomLevel === 1. */}
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>{minimap}</div>
    </div>
  );
}
