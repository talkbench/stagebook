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

/**
 * Shape shared between the playhead time box and the handle tooltips.
 *
 * Deliberately carries NO colour. The two consumers sit on different
 * themeable surfaces — the handle tooltip on a background derived from the
 * accent, the playhead box on --stagebook-playhead — and each sets its own
 * foreground token.
 *
 * A single shared foreground was the first attempt at #619 and is wrong: a
 * host retuning only one of the two backgrounds to something light has no
 * value it can set that stays readable on both, because one token feeds both
 * surfaces. Independently themeable backgrounds need independently themeable
 * foregrounds (#629 review).
 */
export const tooltipBaseStyle: React.CSSProperties = {
  fontSize: "0.65rem",
  fontFamily: TIMELINE_MONO_FONT,
  padding: "1px 4px",
  borderRadius: "2px",
  whiteSpace: "nowrap",
  lineHeight: 1.4,
  pointerEvents: "none",
};

/** Text on a range-handle tooltip (background: --stagebook-timeline-tooltip-bg). */
export const TOOLTIP_FG = "var(--stagebook-timeline-tooltip-fg, #fff)";

/** Text on the playhead's time box (background: --stagebook-playhead). */
export const PLAYHEAD_FG = "var(--stagebook-playhead-fg, #fff)";

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
    color: TOOLTIP_FG,
  };
}
