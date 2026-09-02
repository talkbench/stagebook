/**
 * Test wrapper for WaveformTimeline (#596).
 *
 * Playwright CT serializes props across the worker boundary, so a
 * `Float32Array` cannot be passed straight through. This wrapper accepts the
 * interleaved min/max peaks as a plain `number[]`, converts them internally,
 * and bumps `peaksVersion` whenever a new array reference arrives — the same
 * shape MockTimeline uses for its per-channel `mockPeaks`.
 *
 * `width` pins the container to a known pixel width so a test can compute the
 * playhead's expected offset; `playheadColor` sets the `--stagebook-playhead`
 * token on the wrapper so a test can prove the line honors the theme token
 * rather than its fallback.
 */
import React, { useRef } from "react";
import {
  WaveformTimeline,
  type WaveformTimelineProps,
} from "../elements/timeline/WaveformTimeline.js";

export interface MockWaveformTimelineProps
  extends Omit<WaveformTimelineProps, "peaks" | "peaksVersion"> {
  /** Interleaved min/max pairs per bucket, as plain numbers. */
  mockPeaks?: number[] | null;
  /** Container width in CSS px. */
  width?: number;
  /** Value for the `--stagebook-playhead` token on the wrapper. */
  playheadColor?: string;
}

export function MockWaveformTimeline({
  mockPeaks = null,
  width = 400,
  playheadColor,
  ...props
}: MockWaveformTimelineProps) {
  const lastMockPeaksRef = useRef<number[] | null | undefined>(undefined);
  const peaksRef = useRef<Float32Array | null>(null);
  const peaksVersionRef = useRef(0);
  if (lastMockPeaksRef.current !== mockPeaks) {
    lastMockPeaksRef.current = mockPeaks;
    peaksRef.current = mockPeaks == null ? null : Float32Array.from(mockPeaks);
    peaksVersionRef.current += 1;
  }
  const style: React.CSSProperties & Record<string, string | number> = {
    width: `${String(width)}px`,
  };
  if (playheadColor !== undefined) {
    style["--stagebook-playhead"] = playheadColor;
  }
  return (
    <div data-testid="mock-waveform-timeline" style={style}>
      <WaveformTimeline
        {...props}
        peaks={peaksRef.current}
        peaksVersion={peaksVersionRef.current}
      />
    </div>
  );
}
