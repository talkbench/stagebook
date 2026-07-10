import React, { useCallback, useRef } from "react";
import { formatTime } from "../../../utils/formatTime.js";
import {
  timeToPixel,
  pixelToTime,
  computeTickInterval,
  generateTicks,
} from "./timelineLayout.js";

export interface TimeRulerProps {
  /** Total media duration in seconds. */
  duration: number;
  /** Width of the ruler area in pixels. */
  width: number;
  /** Current zoom level (1 = full duration visible). */
  zoomLevel: number;
  /** Left edge of the visible region in seconds. */
  viewportStart: number;
  /** Called on click / drag to seek the playhead. Standard NLE convention:
   *  clicking the ruler moves the playhead to that time, dragging scrubs. */
  onSeek?: (time: number) => void;
  /** Optional drag-state callbacks so the parent can suppress auto-scroll
   *  while the user is in manual control of the playhead. */
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export const RULER_HEIGHT = 24;

/**
 * Time labels and tick marks along the top of the waveform area.
 * Tick density adapts to zoom level. Click/drag scrubs the playhead.
 */
export function TimeRuler({
  duration,
  width,
  zoomLevel,
  viewportStart,
  onSeek,
  onDragStart,
  onDragEnd,
}: TimeRulerProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Convert a clientX to a clamped time inside the visible viewport. We
  // clamp to viewport (not to [0, duration]) so the playhead stays visible
  // when the user drags off the ruler — matching the Playhead's own clamp.
  const seekToClientX = useCallback(
    (clientX: number) => {
      if (!onSeek) return;
      // Bail on degenerate inputs — pixelToTime divides by `zoomLevel`
      // internally, so 0 / NaN / negative values would produce
      // Infinity/NaN times and unpredictable seeks.
      if (
        !Number.isFinite(zoomLevel) ||
        zoomLevel <= 0 ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(width) ||
        width <= 0
      ) {
        return;
      }
      const el = elRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const time = pixelToTime(
        localX,
        duration,
        width,
        zoomLevel,
        viewportStart,
      );
      const visibleDuration = duration / zoomLevel;
      const lo = Math.max(0, viewportStart);
      const hi = Math.min(duration, viewportStart + visibleDuration);
      onSeek(Math.max(lo, Math.min(hi, time)));
    },
    [duration, width, zoomLevel, viewportStart, onSeek],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (!onSeek) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore in test environments
      }
      isDragging.current = true;
      onDragStart?.();
      seekToClientX(e.clientX);
    },
    [onSeek, onDragStart, seekToClientX],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      seekToClientX(e.clientX);
    },
    [seekToClientX],
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

  if (!Number.isFinite(duration) || duration <= 0 || width <= 0) {
    return (
      <div
        data-testid="time-ruler"
        style={{ height: `${String(RULER_HEIGHT)}px` }}
      />
    );
  }

  const visibleDuration = duration / zoomLevel;
  const visibleEnd = viewportStart + visibleDuration;
  const pixelsPerSecond = width / visibleDuration;
  const interval = computeTickInterval(pixelsPerSecond);
  const ticks = generateTicks(viewportStart, visibleEnd, interval);

  return (
    <div
      ref={elRef}
      data-testid="time-ruler"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      style={{
        position: "relative",
        height: `${String(RULER_HEIGHT)}px`,
        width: `${String(width)}px`,
        overflow: "visible",
        fontSize: "0.72rem",
        color: "var(--stagebook-decoration, #9ca3af)",
        userSelect: "none",
        cursor: onSeek ? "pointer" : "default",
      }}
    >
      {ticks.map((t) => {
        const x = timeToPixel(t, duration, width, zoomLevel, viewportStart);
        if (x < -50 || x > width + 50) return null;
        return (
          <div
            key={t}
            style={{
              position: "absolute",
              left: `${String(x)}px`,
              top: 0,
              transform: "translateX(-50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>{formatTime(t)}</span>
            <div
              style={{
                width: "1px",
                height: "6px",
                background: "currentColor",
                opacity: 0.5,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
