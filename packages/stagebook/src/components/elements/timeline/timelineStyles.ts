/**
 * Shared constants and styles for timeline tooltip boxes (playhead time
 * box and handle hover tooltips). Kept in one place so they don't drift.
 */
import type React from "react";

/**
 * Select fractional-second precision based on zoom level.
 * At zoom 1 (full duration visible) show tenths; at 2× or above show
 * hundredths — more zoom reveals more precision.
 *
 * @param zoomLevel - Current zoom level (1 = full duration visible).
 * @returns Number of fractional digits: 1 or 2.
 */
export function zoomDecimals(zoomLevel: number): 1 | 2 {
  if (zoomLevel >= 2) return 2;
  return 1;
}

/** Monospace font stack used by all timeline time displays. */
const TIMELINE_MONO_FONT =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

/** Base styles shared between the playhead time box and handle tooltips. */
export const tooltipBaseStyle: React.CSSProperties = {
  fontSize: "0.65rem",
  fontFamily: TIMELINE_MONO_FONT,
  padding: "1px 4px",
  borderRadius: "2px",
  whiteSpace: "nowrap",
  lineHeight: 1.4,
  pointerEvents: "none",
  color: "white",
};

/**
 * Compute inline styles for a range-handle hover tooltip. Positions the
 * tooltip on the OUTSIDE of the handle by default (left of start, right
 * of end) so it doesn't cover the range body. When `flip` is true the
 * tooltip swings to the inside of the handle instead — used for handles
 * near the SelectionOverlay's clipped edges, where the default outside
 * position would extend past the clip and get cut off.
 *
 * @param handle - Which handle the tooltip is attached to.
 * @param flip - When true, place the tooltip on the inside of the handle.
 */
export function handleTooltipStyle(
  handle: "start" | "end",
  flip = false,
): React.CSSProperties {
  // start + !flip → left; end + flip → left; otherwise → right
  const placeLeft = (handle === "start") !== flip;
  return {
    position: "absolute",
    top: "50%",
    ...(placeLeft
      ? { right: "100%", marginRight: 4 }
      : { left: "100%", marginLeft: 4 }),
    transform: "translateY(-50%)",
    background: "var(--stagebook-timeline-tooltip-bg, rgba(30, 64, 175, 0.9))",
    zIndex: 5,
    ...tooltipBaseStyle,
  };
}
