import React, { useCallback, useEffect, useRef, useState } from "react";
import { WaveformRenderer } from "./WaveformRenderer.js";
import { timeToPixel } from "./timelineLayout.js";

/** Default track height — the same as one `Timeline` track. */
export const WAVEFORM_TIMELINE_HEIGHT = 48;

export interface WaveformTimelineProps {
  /**
   * Accessible name for the widget. The component renders `role="img"`
   * with this label; the canvas and playhead inside are decorative.
   */
  label: string;
  /**
   * Interleaved min/max pairs per time bucket — the shape `createPeaksArrays`
   * allocates and `peaksFromSamples` produces. `null` draws the empty track.
   */
  peaks: Float32Array | null;
  /**
   * Render token. Peaks arrays are typically mutated in place while audio is
   * captured, so the reference never changes; bump this counter to redraw.
   */
  peaksVersion: number;
  /**
   * Axis extent in seconds. The full peaks array is stretched across the
   * track, and the playhead is positioned at `currentTime / duration`. A
   * non-positive or non-finite duration hides the playhead.
   */
  duration: number;
  /**
   * Playhead position in seconds, clamped to `[0, duration]`. `null` hides
   * the playhead (e.g. before anything has been captured).
   *
   * There is no internal animation: the host sets this from its media
   * element's clock on whatever cadence it chooses — every animation frame
   * for smooth motion, or only on `timeupdate` to honor
   * `prefers-reduced-motion`.
   */
  currentTime: number | null;
  /** Track height in CSS px. Defaults to `WAVEFORM_TIMELINE_HEIGHT`. */
  height?: number;
}

/**
 * Read-only amplitude track with an optional playhead (#596).
 *
 * A standalone display primitive — no `StagebookProvider`, no playback
 * handle, no selections — that renders the same `WaveformRenderer` and theme
 * tokens (`--stagebook-waveform-color`, `--stagebook-waveform-track-bg`,
 * `--stagebook-playhead`) as the `Timeline` element, so a host drawing its
 * own recording (a microphone check, a voice note) matches Stagebook's
 * timeline visual language without taking on `Timeline`'s source and
 * editing contracts.
 */
export function WaveformTimeline({
  label,
  peaks,
  peaksVersion,
  duration,
  currentTime,
  height = WAVEFORM_TIMELINE_HEIGHT,
}: WaveformTimelineProps) {
  // Measure the content width with a callback ref (usable on first paint)
  // and keep it current with a ResizeObserver — the same pattern Timeline
  // uses. The content box excludes the 1px border so the canvas and the
  // playhead share one coordinate space.
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const totalBuckets = peaks ? Math.floor(peaks.length / 2) : 0;
  const hasAxis = Number.isFinite(duration) && duration > 0;
  const showPlayhead =
    hasAxis &&
    width > 0 &&
    currentTime !== null &&
    Number.isFinite(currentTime);
  const playheadX = showPlayhead
    ? timeToPixel(
        Math.min(duration, Math.max(0, currentTime)),
        duration,
        width,
        1,
        0,
      )
    : 0;

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={label}
      data-testid="waveform-timeline"
      style={{
        position: "relative",
        boxSizing: "border-box",
        width: "100%",
        // Border adds to the content height so the track keeps its full size.
        height: `${String(height + 2)}px`,
        overflow: "hidden",
        border: "1px solid var(--stagebook-border, #d1d5db)",
        borderRadius: "0.5rem",
      }}
    >
      {width > 0 && (
        <WaveformRenderer
          peaks={peaks}
          peaksVersion={peaksVersion}
          width={width}
          height={height}
          startBucket={0}
          endBucket={totalBuckets}
        />
      )}
      {showPlayhead && (
        <div
          data-testid="waveform-timeline-playhead"
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: `${String(playheadX)}px`,
            width: "2px",
            height: "100%",
            // Center the 2px line on the computed x, as Timeline's Playhead
            // does. No transition: motion is the host's decision.
            transform: "translateX(-50%)",
            background: "var(--stagebook-playhead, #be123c)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
