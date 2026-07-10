import React, { useCallback, useRef } from "react";
import type { TimelineValue } from "./selections.js";
import { clampViewportStart } from "./viewport.js";
import { WaveformRenderer } from "./WaveformRenderer.js";

export interface MinimapProps {
  /** Total media duration in seconds. */
  duration: number;
  /** Width of the minimap area in pixels. */
  width: number;
  /** Current zoom level (1 = full visible). */
  zoomLevel: number;
  /** Current viewport start in seconds. */
  viewportStart: number;
  /** Current playhead position in seconds. */
  currentTime: number;
  /** All current selections — drawn as small marks on the minimap. */
  selections: TimelineValue;
  /**
   * Per-channel interleaved min/max peaks. The minimap draws channel 0 as a
   * single-channel summary stand-in; the minimap is too small for per-channel
   * separation. Shared reference with the main tracks, so redraws when peaks
   * fill in are driven by peaksVersion.
   */
  peaks: Float32Array[];
  /**
   * Render token: bumps when peaks are mutated in place. Forces the
   * waveform canvas to redraw despite a stable array reference.
   */
  peaksVersion: number;
  /** Total number of buckets covering the full duration. */
  totalBuckets: number;
  /** Called with new viewport start (seconds) when the user pans. */
  onViewportChange: (newStart: number) => void;
}

const HEIGHT = 32;
const VIEWPORT_RECT_BORDER =
  "1.5px solid var(--stagebook-timeline-minimap-viewport-border, rgba(37, 99, 235, 0.9))";

function isRangeArray(
  s: TimelineValue,
): s is { start: number; end: number; track?: number }[] {
  return s.length === 0 || "start" in (s[0] as object);
}

interface DragState {
  pointerId: number;
  /** Offset in seconds between pointerdown time and viewportStart. */
  offset: number;
}

export function Minimap({
  duration,
  width,
  zoomLevel,
  viewportStart,
  currentTime,
  selections,
  peaks,
  peaksVersion,
  totalBuckets,
  onViewportChange,
}: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const visibleDuration = duration > 0 ? duration / zoomLevel : 0;

  const eventToTime = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const t = (localX / rect.width) * duration;
      return Math.max(0, Math.min(duration, t));
    },
    [duration],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const time = eventToTime(e.clientX);
      const viewportEnd = viewportStart + visibleDuration;

      // If clicking inside the viewport rectangle, drag-pan it (preserve offset)
      // Otherwise, click to center the viewport on that point
      let offset: number;
      if (time >= viewportStart && time <= viewportEnd) {
        offset = time - viewportStart;
      } else {
        // Click to center viewport — apply immediately
        const newStart = clampViewportStart(
          time - visibleDuration / 2,
          duration,
          zoomLevel,
        );
        onViewportChange(newStart);
        offset = visibleDuration / 2;
      }

      dragRef.current = { pointerId: e.pointerId, offset };
      // Pointer capture lets us track drag outside the element. In tests
      // (Playwright dispatchEvent), the pointerId may not be a real OS
      // pointer, so we silently ignore failures.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [
      eventToTime,
      viewportStart,
      visibleDuration,
      duration,
      zoomLevel,
      onViewportChange,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const time = eventToTime(e.clientX);
      const newStart = clampViewportStart(
        time - drag.offset,
        duration,
        zoomLevel,
      );
      onViewportChange(newStart);
    },
    [eventToTime, duration, zoomLevel, onViewportChange],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  }, []);

  const timeToX = useCallback(
    (t: number) => (duration > 0 ? (t / duration) * width : 0),
    [duration, width],
  );

  // Selection marks
  const selectionMarks: React.ReactElement[] = [];
  if (isRangeArray(selections)) {
    selections.forEach((r, i) => {
      const x1 = timeToX(r.start);
      const x2 = timeToX(r.end);
      selectionMarks.push(
        <div
          key={`r-${String(i)}`}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${String(x1)}px`,
            top: 4,
            width: `${String(Math.max(x2 - x1, 1))}px`,
            height: HEIGHT - 8,
            background:
              "var(--stagebook-timeline-minimap-range, rgba(37, 99, 235, 0.4))",
            borderRadius: "1px",
            pointerEvents: "none",
          }}
        />,
      );
    });
  } else {
    (selections as { time: number }[]).forEach((p, i) => {
      const x = timeToX(p.time);
      selectionMarks.push(
        <div
          key={`p-${String(i)}`}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${String(x - 1)}px`,
            top: 4,
            width: 2,
            height: HEIGHT - 8,
            background:
              "var(--stagebook-timeline-minimap-point, rgba(37, 99, 235, 0.7))",
            pointerEvents: "none",
          }}
        />,
      );
    });
  }

  // Viewport rectangle position
  const viewportLeft = timeToX(viewportStart);
  const viewportWidth = Math.max(timeToX(visibleDuration), 8);

  // Playhead
  const playheadX = timeToX(currentTime);

  return (
    <div
      ref={containerRef}
      data-testid="timeline-minimap"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: "relative",
        height: `${String(HEIGHT)}px`,
        width: `${String(width)}px`,
        background: "var(--stagebook-bg-muted, #f9fafb)",
        cursor: "pointer",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {/* Compressed full-duration waveform — drawn behind selection marks,
          viewport rect, and playhead. Channel 0 is used as a single-channel
          summary stand-in (the minimap is too small for per-channel bars).
          Passing the full bucket range [0, totalBuckets] makes
          WaveformRenderer naturally compress many source buckets into each
          canvas pixel. */}
      {peaks.length > 0 && totalBuckets > 0 && (
        <div
          data-testid="minimap-waveform"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            opacity: 0.5,
            pointerEvents: "none",
          }}
        >
          <WaveformRenderer
            peaks={peaks[0] ?? null}
            peaksVersion={peaksVersion}
            width={width}
            height={HEIGHT}
            startBucket={0}
            endBucket={totalBuckets}
          />
        </div>
      )}
      {selectionMarks}
      {/* Playhead line */}
      {currentTime >= 0 && currentTime <= duration && (
        <div
          data-testid="minimap-playhead"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${String(playheadX - 0.5)}px`,
            top: 0,
            width: "1px",
            height: "100%",
            background: "rgba(37, 99, 235, 0.8)",
            pointerEvents: "none",
          }}
        />
      )}
      {/* Viewport rectangle */}
      <div
        data-testid="minimap-viewport"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: `${String(viewportLeft)}px`,
          top: 0,
          width: `${String(viewportWidth)}px`,
          height: "100%",
          border: VIEWPORT_RECT_BORDER,
          boxSizing: "border-box",
          background:
            "var(--stagebook-timeline-minimap-viewport-bg, rgba(37, 99, 235, 0.06))",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
