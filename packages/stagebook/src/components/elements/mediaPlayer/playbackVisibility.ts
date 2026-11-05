export interface PlaybackVisibilityStats {
  hiddenPlaybackSeconds: number;
  unfocusedPlaybackSeconds: number;
  visibilityChangesDuringPlayback: number;
}

interface PlaybackVisibilityOptions {
  /** Monotonic milliseconds, normally performance.now(). */
  now: () => number;
  hidden: boolean;
  focused: boolean;
  initial?: Partial<PlaybackVisibilityStats>;
}

function nonnegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/**
 * Counts elapsed wall time while the backend reports actual playback. The
 * caller starts/stops it on playing/buffering/transport transitions and samples
 * it on existing saves. It owns no timers, event listeners, or I/O. Hidden and
 * unfocused intervals overlap; neither metric measures unique media coverage.
 */
export function createPlaybackVisibility({
  now,
  hidden,
  focused,
  initial,
}: PlaybackVisibilityOptions) {
  const changes = nonnegative(initial?.visibilityChangesDuringPlayback);
  const stats: PlaybackVisibilityStats = {
    hiddenPlaybackSeconds: nonnegative(initial?.hiddenPlaybackSeconds),
    unfocusedPlaybackSeconds: nonnegative(initial?.unfocusedPlaybackSeconds),
    visibilityChangesDuringPlayback: Number.isInteger(changes) ? changes : 0,
  };
  // Restoring totals never assumes an active interval survived the prior mount.
  let playing = false;
  const initialTime = now();
  let lastTime = Number.isFinite(initialTime) ? initialTime : 0;

  const settle = () => {
    const time = now();
    if (!Number.isFinite(time) || time <= lastTime) return;
    const elapsed = (time - lastTime) / 1000;
    lastTime = time;
    if (playing) {
      if (hidden) stats.hiddenPlaybackSeconds += elapsed;
      if (!focused) stats.unfocusedPlaybackSeconds += elapsed;
    }
  };

  return {
    isPlaying: () => playing,
    setPlaying(next: boolean) {
      settle();
      playing = next;
    },
    setVisibility(next: boolean) {
      settle();
      if (playing && hidden !== next)
        stats.visibilityChangesDuringPlayback += 1;
      hidden = next;
    },
    setFocused(next: boolean) {
      settle();
      focused = next;
    },
    snapshot(): PlaybackVisibilityStats {
      settle();
      return { ...stats };
    },
  };
}
