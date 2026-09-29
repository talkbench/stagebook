import type { VideoEvent } from "../components/elements/MediaPlayer.js";

/**
 * Derives watched time ranges from a VideoEvent log.
 *
 * A "play" opens a range. A "pause", "ended", "stopAt" or "stageEnd" closes
 * it. A "seek" during playback closes it at the seek's `fromTime` and opens
 * a new one at its target, so skipped footage never counts as watched
 * (#682); seeks while paused change nothing. Empty or backwards ranges are
 * dropped. Overlapping or touching ranges are merged. An open range at the
 * end of the log (a "play" with no closing event — e.g. a mid-playback
 * disconnect) is excluded, as we can't confirm how far the participant got.
 *
 * Returns intervals sorted by start time in the form [startSeconds, endSeconds].
 */
export function computeWatchedRanges(events: VideoEvent[]): [number, number][] {
  // 1. Build closed intervals
  const intervals: [number, number][] = [];
  let openStart: number | null = null;
  const close = (end: number) => {
    if (openStart !== null && end > openStart) {
      intervals.push([openStart, end]);
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
      case "stageEnd":
        close(event.videoTime);
        break;
      case "speed":
        break;
    }
  }
  // open play at end is intentionally excluded

  if (intervals.length === 0) return [];

  // 2. Sort by start time
  intervals.sort((a, b) => a[0] - b[0]);

  // 3. Merge overlapping / adjacent intervals
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
