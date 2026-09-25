import type { PlaybackHandle } from "./PlaybackHandle.js";

type Bounds = { start: number; end: number };

/** A MediaPlayer's window settings. */
export interface SeekWindowSettings {
  startAt?: number;
  stopAt?: number;
  allowScrubOutsideBounds: boolean;
}

/**
 * The span a MediaPlayer lets participants seek within, in media seconds:
 * `[startAt, stopAt]` unless `allowScrubOutsideBounds`, capped at the file.
 * An open end is `Infinity` until the duration is known. An empty window
 * (startAt at or past the end of the file) can't be played, so it falls back
 * to the whole file — the same fallback the Timeline's domain uses (#675).
 */
export function seekWindow(
  settings: SeekWindowSettings,
  duration: number,
): Bounds {
  const fileEnd =
    Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  if (settings.allowScrubOutsideBounds) return { start: 0, end: fileEnd };
  const start = Math.min(Math.max(settings.startAt ?? 0, 0), fileEnd);
  const end = Math.min(Math.max(settings.stopAt ?? fileEnd, 0), fileEnd);
  return end > start ? { start, end } : { start: 0, end: fileEnd };
}

/**
 * Wrap a PlaybackHandle so `seekTo` stays inside the player's window and
 * `getBounds` reports it (#675). Every seek a sibling issues — a Timeline's
 * ruler, playhead drag or arrow keys — goes through here, so none can take
 * the player outside `[startAt, stopAt]`.
 *
 * `getBounds` is read on every call, so the wrapper stays valid when the
 * window changes or the duration becomes known. Everything else delegates
 * through getters rather than being copied: peaks are mutated in place and
 * versioned, and a spread would freeze them.
 */
export function withSeekWindow(
  inner: PlaybackHandle,
  getBounds: () => Bounds,
): PlaybackHandle {
  return {
    play: () => inner.play(),
    pause: () => inner.pause(),
    seekTo: (seconds: number) => {
      const { start, end } = getBounds();
      inner.seekTo(Math.max(start, Math.min(end, seconds)));
    },
    getCurrentTime: () => inner.getCurrentTime(),
    getDuration: () => inner.getDuration(),
    getBounds,
    isPaused: () => inner.isPaused(),
    get isYouTube() {
      return inner.isYouTube;
    },
    get channelCount() {
      return inner.channelCount;
    },
    get peaks() {
      return inner.peaks;
    },
    get peaksVersion() {
      return inner.peaksVersion;
    },
    get durationVersion() {
      return inner.durationVersion;
    },
    requestWaveformCapture: () => inner.requestWaveformCapture(),
    setChannelMuted: (channel: number, muted: boolean) =>
      inner.setChannelMuted(channel, muted),
    isChannelMuted: (channel: number) => inner.isChannelMuted(channel),
  };
}
