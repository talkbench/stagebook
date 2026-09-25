/** Unified playback interface. Both HTML5 VideoCore and YouTubePlayer expose this via ref. */
export interface PlaybackHandle {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  /**
   * The span participants may reach, in media seconds: a MediaPlayer's
   * `[startAt, stopAt]` unless `allowScrubOutsideBounds` is set. `seekTo`
   * clamps to it, and a Timeline shows only this span (#675). `end` is
   * `Infinity` while an open-ended window's duration is still unknown.
   *
   * Optional for backward compatibility — consumers treat a handle without
   * it as spanning `[0, getDuration()]`.
   */
  getBounds?(): { start: number; end: number };
  isPaused(): boolean;
  /** True when backed by the YouTube IFrame API; frame-step controls should be hidden. */
  readonly isYouTube: boolean;

  /** Number of audio channels in the media. 0 until waveform capture starts. */
  readonly channelCount: number;

  /**
   * Per-channel waveform peaks. One Float32Array per channel, containing
   * interleaved min/max pairs per time bucket. Empty until capture starts.
   * Shared across all timelines — read-only.
   *
   * IMPORTANT: these arrays are mutated in place during capture. Consumers
   * that need to know when the data changed should read `peaksVersion`,
   * which bumps every time a frame is accumulated.
   */
  readonly peaks: Float32Array[];

  /**
   * Monotonically increasing counter that bumps every time `peaks` is
   * mutated by the capture loop. Use this as a render-token in React effects
   * (e.g., a canvas redraw effect) so they re-run when peaks change despite
   * the array reference being stable.
   */
  readonly peaksVersion: number;

  /**
   * Monotonically increasing counter that bumps when the media duration
   * becomes known (loadedmetadata). Consumers that render based on duration
   * (e.g., Timeline selection positioning) should read this to trigger a
   * re-render once the duration is available.
   *
   * Optional for backward compatibility — external PlaybackHandle
   * implementations that predate this field treat undefined as 0.
   */
  readonly durationVersion?: number;

  /**
   * Request the MediaPlayer to start capturing waveform data.
   * Lazily creates AudioContext + AnalyserNodes on first call.
   * No-op on subsequent calls. No-op for YouTube sources.
   */
  requestWaveformCapture(): void;

  /**
   * Mute or unmute a single audio channel in the output. Ephemeral — not
   * persisted, a listening aid only. Silences the channel at the GainNode
   * placed between splitter and merger, so the waveform (which taps the
   * pre-gain signal) is unaffected. Out-of-range channel indices are
   * ignored. No-op before waveform capture has been started, and for
   * YouTube sources.
   */
  setChannelMuted(channel: number, muted: boolean): void;

  /** Returns true when the given channel is currently muted. */
  isChannelMuted(channel: number): boolean;
}
