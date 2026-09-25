import React, { useCallback, useRef } from "react";
import { formatTime } from "../../../utils/formatTime.js";
import {
  timeToPixel,
  pixelToTime,
  computeTickInterval,
  generateTicks,
} from "./timelineLayout.js";
import { domainSpan, type TimeDomain } from "./domain.js";

export interface TimeRulerProps {
  /** Span shown at zoom 1, in media seconds (the whole file or the
   *  source player's window). Tick labels are media time. */
  domain: TimeDomain;
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
  domain,
  width,
  zoomLevel,
  viewportStart,
  onSeek,
  onDragStart,
  onDragEnd,
}: TimeRulerProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const span = domainSpan(domain);

  // Convert a clientX to a clamped time inside the visible viewport. We
  // clamp to viewport (not just to the domain) so the playhead stays
  // visible when the user drags off the ruler — matching the Playhead's own
  // clamp. The viewport lies inside the domain, so seeks stay there too.
  const seekToClientX = useCallback(
    (clientX: number) => {
      if (!onSeek) return;
      // Bail on degenerate inputs — pixelToTime divides by `zoomLevel`
      // internally, so 0 / NaN / negative values would produce
      // Infinity/NaN times and unpredictable seeks.
      if (
        !Number.isFinite(zoomLevel) ||
        zoomLevel <= 0 ||
        !Number.isFinite(span) ||
        span <= 0 ||
        !Number.isFinite(width) ||
        width <= 0
      ) {
        return;
      }
      const el = elRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const time = pixelToTime(localX, span, width, zoomLevel, viewportStart);
      const visibleDuration = span / zoomLevel;
      const lo = Math.max(domain.start, viewportStart);
      const hi = Math.min(domain.end, viewportStart + visibleDuration);
      onSeek(Math.max(lo, Math.min(hi, time)));
    },
    [domain, span, width, zoomLevel, viewportStart, onSeek],
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

  if (!Number.isFinite(span) || span <= 0 || width <= 0) {
    return (
      <div
        data-testid="time-ruler"
        style={{ height: `${String(RULER_HEIGHT)}px` }}
      />
    );
  }

  const visibleDuration = span / zoomLevel;
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
        color: "var(--stagebook-timeline-ruler-text, #737373)",
        userSelect: "none",
        cursor: onSeek ? "pointer" : "default",
      }}
    >
      {ticks.map((t) => {
        const x = timeToPixel(t, span, width, zoomLevel, viewportStart);
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
