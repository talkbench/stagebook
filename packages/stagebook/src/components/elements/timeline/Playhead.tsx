import React, { useCallback, useRef } from "react";
import { timeToPixel, pixelToTime } from "./timelineLayout.js";
import { formatTime } from "../../../utils/formatTime.js";
import { zoomDecimals, tooltipBaseStyle } from "./timelineStyles.js";

/**
 * How far off-screen (in pixels) the playhead can be before we skip
 * rendering. Needs to be wide enough to keep the time box visible
 * when the playhead line is just past the edge.
 */
const OFFSCREEN_PADDING = 20;

export interface PlayheadProps {
  /** Current playback time in seconds. */
  currentTime: number;
  /** Total media duration in seconds. */
  duration: number;
  /** Width of the waveform area in pixels. */
  width: number;
  /** Height of the tracks area in pixels. */
  height: number;
  /** Height of the ruler area — playhead extends upward by this amount. */
  rulerHeight: number;
  /** Current zoom level (1 = full duration visible). */
  zoomLevel: number;
  /** Left edge of the visible region in seconds. */
  viewportStart: number;
  /** Called during drag to seek to a new time. */
  onSeek: (time: number) => void;
  /** Called on pointerdown when a drag starts. Lets the parent suppress
   *  auto-scroll while the user is in manual control of the playhead. */
  onDragStart?: () => void;
  /** Called on pointerup / cancel / lostpointercapture — i.e., whenever
   *  a drag transaction ends, however it ends. */
  onDragEnd?: () => void;
}

/**
 * Vertical playhead line with a draggable time box in the ruler area.
 *
 * The time box sits above the tracks (via negative top) and is the only
 * part that receives pointer events — the line stays pointerEvents: "none"
 * so it doesn't interfere with the SelectionOverlay underneath.
 *
 * IMPORTANT: This component MUST live in the same position: relative
 * container as the SelectionOverlay to guarantee pixel-perfect alignment.
 * Both use timeToPixel from the same coordinate space.
 */
export function Playhead({
  currentTime,
  duration,
  width,
  height,
  rulerHeight,
  zoomLevel,
  viewportStart,
  onSeek,
  onDragStart,
  onDragEnd,
}: PlayheadProps) {
  // All hooks must be called before any early returns (Rules of Hooks).
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore in test environments
      }
      isDragging.current = true;
      onDragStart?.();
    },
    [onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      // Convert pointer position to time using the tracks container's rect.
      // The playhead's parent is the same container as the SelectionOverlay,
      // offset by GUTTER_WIDTH — so we use the parent's bounding rect.
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const time = pixelToTime(
        localX,
        duration,
        width,
        zoomLevel,
        viewportStart,
      );
      // Clamp drag to the visible viewport so the playhead can't be dragged
      // off-screen — without this, dragging into the gutter sends it to t=0
      // (invisible left of viewport when zoomed in) and dragging past the
      // right edge sends it past viewportEnd (invisible until you pan).
      const visibleDuration = zoomLevel > 0 ? duration / zoomLevel : duration;
      const viewportEnd = Math.min(duration, viewportStart + visibleDuration);
      const lo = Math.max(0, viewportStart);
      const hi = Math.min(duration, viewportEnd);
      const clamped = Math.max(lo, Math.min(hi, time));
      onSeek(clamped);
    },
    [duration, width, zoomLevel, viewportStart, onSeek],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasDragging = isDragging.current;
      isDragging.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (wasDragging) onDragEnd?.();
    },
    [onDragEnd],
  );

  const handlePointerCancel = useCallback(() => {
    const wasDragging = isDragging.current;
    isDragging.current = false;
    if (wasDragging) onDragEnd?.();
  }, [onDragEnd]);

  // Early returns after all hooks
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const x = timeToPixel(currentTime, duration, width, zoomLevel, viewportStart);
  if (x < -OFFSCREEN_PADDING || x > width + OFFSCREEN_PADDING) return null;

  return (
    <div
      ref={containerRef}
      data-testid="playhead"
      style={{
        position: "absolute",
        left: `${String(x)}px`,
        top: `${String(-rulerHeight)}px`,
        width: 0,
        height: `${String(height + rulerHeight)}px`,
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      {/* Time box — draggable handle in the ruler area. The triangle child
          hanging off the bottom is the "playhead head" affordance from
          standard NLE timelines (Premiere, Resolve, etc.) — it visually
          attaches the box to the line below and reads as "this is the
          handle of the line." It inherits the box's red color and bubbles
          pointer events up to the box, so dragging from the triangle works
          the same as dragging from the box. */}
      <div
        draggable={false}
        onPointerDown={(e) => {
          e.preventDefault(); // suppress native drag-and-drop
          handlePointerDown(e);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        style={{
          ...tooltipBaseStyle,
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          pointerEvents: "auto",
          background: "var(--stagebook-playhead, #be123c)",
          cursor: "ew-resize",
          userSelect: "none",
        }}
      >
        {formatTime(currentTime, zoomDecimals(zoomLevel))}
        <div
          data-testid="playhead-arrow"
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "5px solid var(--stagebook-playhead, #be123c)",
            // Inherit auto pointer events so clicks bubble up to the box.
            pointerEvents: "auto",
            cursor: "ew-resize",
          }}
        />
      </div>

      {/* Vertical line — click-through */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "2px",
          height: "100%",
          background: "var(--stagebook-playhead, #be123c)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
