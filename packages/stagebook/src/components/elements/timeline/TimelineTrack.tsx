import React, { useId } from "react";
import { WaveformRenderer } from "./WaveformRenderer.js";
import { useMessages, useIsRTL } from "../../StagebookProvider.js";

export interface TimelineTrackProps {
  /** Label shown in the gutter (from trackLabels or the "Track N" fallback). */
  label: string;
  /** Interleaved min/max peaks for this channel. */
  peaks: Float32Array | null;
  /**
   * Render token: bumps when peaks are mutated in place. Forces the
   * WaveformRenderer to redraw despite a stable array reference.
   */
  peaksVersion: number;
  /** Width of the waveform area in pixels (excludes gutter). */
  waveformWidth: number;
  /** Height of this track in pixels. */
  height: number;
  /** First visible bucket index. */
  startBucket: number;
  /** Last visible bucket index (exclusive). */
  endBucket: number;
  /** Whether this track is muted (drives button visual state). */
  muted: boolean;
  /** Toggle mute — called with the new muted state. */
  onToggleMute: (nextMuted: boolean) => void;
}

const GUTTER_WIDTH = 32;
const MUTE_BUTTON_WIDTH = 22;

/**
 * One row in the timeline: a narrow gutter (mute button) + a WaveformRenderer
 * with the track label overlaid in its upper-left corner.
 */
export function TimelineTrack({
  label,
  peaks,
  peaksVersion,
  waveformWidth,
  height,
  startBucket,
  endBucket,
  muted,
  onToggleMute,
}: TimelineTrackProps) {
  const messages = useMessages();
  const isRTL = useIsRTL();
  // Scoped class for the mute button's `:focus-visible` ring + hover
  // (#382 polish). Same useId pattern as Button / Slider / ListSorter.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const muteClass = `stagebook-timeline-mute-${safeId}`;
  return (
    <div
      data-testid="timeline-track"
      style={{
        display: "flex",
        alignItems: "stretch",
        height: `${String(height)}px`,
      }}
    >
      <style>{`
        .${muteClass}:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--stagebook-focus-ring, rgba(37, 99, 235, 0.25));
        }
        .${muteClass}:hover {
          background: var(--stagebook-hover-bg, #f3f4f6);
        }
      `}</style>
      <div
        data-testid="track-gutter"
        style={{
          boxSizing: "border-box",
          width: `${String(GUTTER_WIDTH)}px`,
          minWidth: `${String(GUTTER_WIDTH)}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRight: "1px solid var(--stagebook-border, #d1d5db)",
        }}
      >
        <button
          type="button"
          className={muteClass}
          data-testid="track-mute"
          data-muted={muted}
          aria-label={
            muted
              ? messages.timelineUnmuteTrack(label)
              : messages.timelineMuteTrack(label)
          }
          aria-pressed={muted}
          onClick={() => onToggleMute(!muted)}
          // Explicit tabIndex for Safari Tab-focus (#415 / #413).
          tabIndex={0}
          style={{
            width: `${String(MUTE_BUTTON_WIDTH)}px`,
            minWidth: `${String(MUTE_BUTTON_WIDTH)}px`,
            height: `${String(MUTE_BUTTON_WIDTH)}px`,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderRadius: "0.25rem",
            cursor: "pointer",
            color: muted
              ? "var(--stagebook-danger, #b91c1c)"
              : "var(--stagebook-decoration, #9ca3af)",
          }}
        >
          {muted ? <SpeakerMutedIcon /> : <SpeakerIcon />}
        </button>
      </div>
      <div style={{ position: "relative" }}>
        <WaveformRenderer
          peaks={peaks}
          peaksVersion={peaksVersion}
          width={waveformWidth}
          height={height}
          startBucket={startBucket}
          endBucket={endBucket}
        />
        <span
          data-testid="track-label"
          dir={isRTL ? "rtl" : "ltr"}
          style={{
            position: "absolute",
            top: "4px",
            left: "4px",
            boxSizing: "border-box",
            padding: "1px 6px",
            fontSize: "0.7rem",
            lineHeight: 1.4,
            color: "var(--stagebook-text-muted, #6b7280)",
            background:
              "var(--stagebook-timeline-track-label-bg, rgba(255, 255, 255, 0.85))",
            border: "1px solid var(--stagebook-border, #d1d5db)",
            borderRadius: "0.25rem",
            userSelect: "none",
            pointerEvents: "none",
            maxWidth: `${String(Math.max(waveformWidth - 8, 0))}px`,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakerMutedIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

export { GUTTER_WIDTH };
