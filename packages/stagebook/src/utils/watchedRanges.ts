import type { VideoEvent } from "../components/elements/MediaPlayer.js";

/**
 * Walks a VideoEvent log. A "play" opens a range. A "pause", "ended",
 * "stopAt" or "removed" closes it. A "seek" during playback closes it at the
 * seek's `fromTime` and opens a new one at its target, so skipped footage
 * never counts as watched (#682); seeks while paused change nothing. Empty or
 * backwards ranges are dropped.
 *
 * Returns the closed ranges, unsorted, and the start of the range still open
 * at the end of the log, if any.
 */
function walk(events: VideoEvent[]): {
  closed: [number, number][];
  openStart: number | null;
} {
  const closed: [number, number][] = [];
  let openStart: number | null = null;
  const close = (end: number) => {
    if (openStart !== null && end > openStart) {
      closed.push([openStart, end]);
    }
    openStart = null;
  };

  for (const event of events) {
    switch (event.type) {
      case "play":
        // Only set start if no interval is already open — prevents duplicate
        // play events (e.g. YouTube PLAYING→BUFFERING→PLAYING) from losing
        // the original start time.
        if (openStart === null) openStart = event.videoTime;
        break;
      case "seek":
        if (openStart === null) break;
        if (event.fromTime !== undefined) close(event.fromTime);
        openStart = event.videoTime;
        break;
      case "pause":
      case "ended":
      case "stopAt":
      case "removed":
        close(event.videoTime);
        break;
      case "speed":
        break;
    }
  }
  return { closed, openStart };
}

/** True when the log ends mid-playback: a range is still open (#677). */
export function endsMidPlayback(events: VideoEvent[]): boolean {
  return walk(events).openStart !== null;
}

/**
 * Derives watched time ranges from a VideoEvent log: the ranges `walk`
 * closes, with overlapping or touching ranges merged. An open range at the
 * end of the log (a "play" with no closing event — e.g. a mid-playback
 * disconnect) is excluded, as we can't confirm how far the participant got.
 *
 * Returns intervals sorted by start time in the form [startSeconds, endSeconds].
 */
export function computeWatchedRanges(events: VideoEvent[]): [number, number][] {
  const intervals = walk(events).closed;
  if (intervals.length === 0) return [];

  intervals.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    const [start, end] = intervals[i];
    if (start <= last[1]) {
      // overlapping or touching — extend the end
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}
