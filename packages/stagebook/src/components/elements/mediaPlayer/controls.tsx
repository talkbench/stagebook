/**
 * Transport controls for MediaPlayer.
 *
 * Two components, one per player type:
 *   HTML5Controls  — full controls (play/pause, seek±1s, step±Ns, speed, scrub bar)
 *   YouTubeControls — YouTube subset (play/pause, seek±1s, scrub bar;
 *                     no step/speed — the IFrame API doesn't support frame stepping)
 *
 * All mutable state lives in MediaPlayer; these components receive callbacks and
 * are purely presentational. Inline styles are deliberate — Tailwind is unreliable
 * in Playwright component tests.
 */
import React from "react";
import { formatTime } from "../../../utils/formatTime.js";
import { useMessages } from "../../StagebookProvider.js";
import {
  PlayIcon,
  PauseIcon,
  SeekBackIcon,
  SeekForwardIcon,
  StepBackIcon,
  StepForwardIcon,
} from "./icons.js";

// ---------------------------------------------------------------------------
// Shared button styles
// ---------------------------------------------------------------------------

export const controlBtnBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "9999px",
  color: "#fff",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
};

export const controlBtnSmall: React.CSSProperties = {
  ...controlBtnBase,
  width: 36,
  height: 36,
};

export const controlBtnLarge: React.CSSProperties = {
  ...controlBtnBase,
  width: 48,
  height: 48,
};

// ---------------------------------------------------------------------------
// HTML5Controls
// ---------------------------------------------------------------------------

export interface HTML5ControlsProps {
  controls:
    | { playPause?: boolean; seek?: boolean; step?: boolean; speed?: boolean }
    | undefined;
  isPaused: boolean;
  stepDuration: number;
  playbackRate: number;
  scrubMin: number;
  scrubMax: number;
  currentTime: number;
  duration: number;
  playedPct: number;
  bufferedPct: number;
  /** Seek the video by a signed delta in seconds (buttons and keyboard). */
  onSeek: (delta: number) => void;
  /** Advance to the next playback speed step. */
  onCycleSpeed: () => void;
  /** MouseDown on a seek button — starts the hold-to-fast-scrub timer. */
  onSeekButtonPress: (direction: 1 | -1) => void;
  /**
   * MouseUp on a seek button — ends the hold timer and, if no hold occurred,
   * performs the single-step seek.
   */
  onSeekButtonRelease: (direction: 1 | -1) => void;
  /** MouseLeave on a seek button — cancels the hold timer without seeking. */
  onSeekButtonLeave: () => void;
  /** Toggle play / pause on the HTML5 video element. */
  onPlayPause: () => void;
  /**
   * Scrub bar pointer down — pauses the video if playing, then seeks to
   * targetTime. Callers must also call setPointerCapture.
   */
  onScrubStart: (targetTime: number) => void;
  /** Scrub bar pointer move — seek-only, no play/pause side effect. */
  onScrubMove: (targetTime: number) => void;
  /** Scrub bar pointer up — final seek; resumes play if paused on grab. */
  onScrubEnd: (targetTime: number) => void;
}

export function HTML5Controls({
  controls,
  isPaused,
  stepDuration,
  playbackRate,
  scrubMin,
  scrubMax,
  currentTime,
  duration,
  playedPct,
  bufferedPct,
  onSeek,
  onCycleSpeed,
  onSeekButtonPress,
  onSeekButtonRelease,
  onSeekButtonLeave,
  onPlayPause,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
}: HTML5ControlsProps) {
  const messages = useMessages();
  function posFromEvent(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return scrubMin + pct * (scrubMax - scrubMin);
  }

  return (
    <>
      {/* Transport buttons row — centered, play in the middle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.25rem",
        }}
      >
        {controls?.seek && (
          <button
            data-testid="mediaPlayer-seekBack"
            aria-label={messages.mediaSeekBack}
            title={messages.mediaSeekBackTitleFull}
            tabIndex={0}
            style={controlBtnSmall}
            onMouseDown={() => onSeekButtonPress(-1)}
            onMouseUp={() => onSeekButtonRelease(-1)}
            onMouseLeave={onSeekButtonLeave}
          >
            <SeekBackIcon />
          </button>
        )}

        {controls?.step && (
          <button
            data-testid="mediaPlayer-stepBack"
            aria-label={messages.mediaStepBack(stepDuration)}
            title={messages.mediaStepBackTitle(stepDuration)}
            tabIndex={0}
            style={controlBtnSmall}
            onClick={() => onSeek(-stepDuration)}
          >
            <StepBackIcon />
          </button>
        )}

        {controls?.playPause && (
          <button
            data-testid="mediaPlayer-playPause"
            aria-label={isPaused ? messages.mediaPlay : messages.mediaPause}
            title={
              isPaused ? messages.mediaPlayTitle : messages.mediaPauseTitle
            }
            tabIndex={0}
            style={controlBtnLarge}
            onClick={onPlayPause}
          >
            {isPaused ? <PlayIcon /> : <PauseIcon />}
          </button>
        )}

        {controls?.step && (
          <button
            data-testid="mediaPlayer-stepForward"
            aria-label={messages.mediaStepForward(stepDuration)}
            title={messages.mediaStepForwardTitle(stepDuration)}
            tabIndex={0}
            style={controlBtnSmall}
            onClick={() => onSeek(stepDuration)}
          >
            <StepForwardIcon />
          </button>
        )}

        {controls?.seek && (
          <button
            data-testid="mediaPlayer-seekForward"
            aria-label={messages.mediaSeekForward}
            title={messages.mediaSeekForwardTitleFull}
            tabIndex={0}
            style={controlBtnSmall}
            onMouseDown={() => onSeekButtonPress(1)}
            onMouseUp={() => onSeekButtonRelease(1)}
            onMouseLeave={onSeekButtonLeave}
          >
            <SeekForwardIcon />
          </button>
        )}

        {controls?.speed && (
          <button
            data-testid="mediaPlayer-speed"
            aria-label={messages.mediaSpeedLabel}
            title={messages.mediaSpeedTitle}
            tabIndex={0}
            style={{
              ...controlBtnSmall,
              fontSize: "0.875rem",
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
            }}
            onClick={onCycleSpeed}
          >
            {playbackRate}×
          </button>
        )}
      </div>

      {/* Scrub bar + time display */}
      {controls?.seek && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            data-testid="mediaPlayer-scrubBar"
            role="slider"
            aria-label={messages.mediaSeekSlider}
            aria-valuemin={scrubMin}
            aria-valuemax={scrubMax}
            aria-valuenow={currentTime}
            data-step={stepDuration}
            tabIndex={0}
            style={{
              flex: 1,
              position: "relative",
              height: 20,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // setPointerCapture throws on firefox if the pointerId
                // came from a synthetic dispatchEvent (#417). Real
                // mouse events always succeed. Matches the defensive
                // pattern in timeline/TimeRuler.tsx:88-92.
              }
              onScrubStart(posFromEvent(e));
            }}
            onPointerMove={(e) => {
              if (!(e.buttons & 1)) return;
              onScrubMove(posFromEvent(e));
            }}
            onPointerUp={(e) => onScrubEnd(posFromEvent(e))}
          >
            {/* Track */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                height: 4,
                borderRadius: 2,
                background: "rgba(255,255,255,0.2)",
              }}
            >
              {/* Buffered fill */}
              <div
                data-testid="mediaPlayer-buffered"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: "100%",
                  width: `${String(bufferedPct)}%`,
                  background: "rgba(255,255,255,0.35)",
                  borderRadius: 2,
                  pointerEvents: "none",
                }}
              />
              {/* Played fill */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: "100%",
                  width: `${String(playedPct)}%`,
                  background: "#fff",
                  borderRadius: 2,
                  pointerEvents: "none",
                }}
              />
            </div>
            {/* Thumb */}
            <div
              style={{
                position: "absolute",
                left: `${String(playedPct)}%`,
                transform: "translateX(-50%)",
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                pointerEvents: "none",
              }}
            />
          </div>
          <span
            data-testid="mediaPlayer-time"
            style={{
              color: "#fff",
              fontSize: "0.75rem",
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// YouTubeControls
// ---------------------------------------------------------------------------

export interface YouTubeControlsProps {
  controls: { playPause?: boolean; seek?: boolean } | undefined;
  isPaused: boolean;
  scrubMin: number;
  scrubMax: number;
  currentTime: number;
  duration: number;
  playedPct: number;
  /** Toggle play / pause on the YouTube player. */
  onPlayPause: () => void;
  /** Seek back 1 second. */
  onSeekBack: () => void;
  /** Seek forward 1 second. */
  onSeekForward: () => void;
  /** Scrub bar pointer down — pauses if playing, seeks to targetTime. */
  onScrubStart: (targetTime: number) => void;
  /** Scrub bar pointer move — seek-only. */
  onScrubMove: (targetTime: number) => void;
  /** Scrub bar pointer up — final seek; resumes play if paused on grab. */
  onScrubEnd: (targetTime: number) => void;
}

export function YouTubeControls({
  controls,
  isPaused,
  scrubMin,
  scrubMax,
  currentTime,
  duration,
  playedPct,
  onPlayPause,
  onSeekBack,
  onSeekForward,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
}: YouTubeControlsProps) {
  const messages = useMessages();
  function posFromEvent(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return scrubMin + pct * (scrubMax - scrubMin);
  }

  return (
    <>
      {/* Transport buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.25rem",
        }}
      >
        {controls?.seek && (
          <button
            data-testid="mediaPlayer-seekBack"
            aria-label={messages.mediaSeekBack}
            title={messages.mediaSeekBackTitleMini}
            tabIndex={0}
            style={controlBtnSmall}
            onClick={onSeekBack}
          >
            <SeekBackIcon />
          </button>
        )}

        {controls?.playPause && (
          <button
            data-testid="mediaPlayer-playPause"
            aria-label={isPaused ? messages.mediaPlay : messages.mediaPause}
            title={
              isPaused ? messages.mediaPlayTitle : messages.mediaPauseTitle
            }
            tabIndex={0}
            style={controlBtnLarge}
            onClick={onPlayPause}
          >
            {isPaused ? <PlayIcon /> : <PauseIcon />}
          </button>
        )}

        {controls?.seek && (
          <button
            data-testid="mediaPlayer-seekForward"
            aria-label={messages.mediaSeekForward}
            title={messages.mediaSeekForwardTitleMini}
            tabIndex={0}
            style={controlBtnSmall}
            onClick={onSeekForward}
          >
            <SeekForwardIcon />
          </button>
        )}
      </div>

      {/* Scrub bar + time display (no buffered fill — IFrame API doesn't expose it) */}
      {controls?.seek && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            data-testid="mediaPlayer-scrubBar"
            role="slider"
            aria-label={messages.mediaSeekSlider}
            aria-valuemin={scrubMin}
            aria-valuemax={scrubMax}
            aria-valuenow={currentTime}
            tabIndex={0}
            style={{
              flex: 1,
              position: "relative",
              height: 20,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // setPointerCapture throws on firefox if the pointerId
                // came from a synthetic dispatchEvent (#417). Real
                // mouse events always succeed. Matches the defensive
                // pattern in timeline/TimeRuler.tsx:88-92.
              }
              onScrubStart(posFromEvent(e));
            }}
            onPointerMove={(e) => {
              if (!(e.buttons & 1)) return;
              onScrubMove(posFromEvent(e));
            }}
            onPointerUp={(e) => onScrubEnd(posFromEvent(e))}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                height: 4,
                borderRadius: 2,
                background: "rgba(255,255,255,0.2)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: "100%",
                  width: `${String(playedPct)}%`,
                  background: "#fff",
                  borderRadius: 2,
                  pointerEvents: "none",
                }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: `${String(playedPct)}%`,
                transform: "translateX(-50%)",
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                pointerEvents: "none",
              }}
            />
          </div>
          <span
            data-testid="mediaPlayer-time"
            style={{
              color: "#fff",
              fontSize: "0.75rem",
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      )}
    </>
  );
}
