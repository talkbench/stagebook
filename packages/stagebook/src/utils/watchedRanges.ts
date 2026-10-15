import type {
  VideoEvent,
  VideoPlaybackRecord,
} from "../schemas/mediaPlayerRecord.js";

/**
 * Walks a VideoEvent log. A "play" opens a range. A "pause", "ended",
 * "stopAt" or "removed" closes it. A "seek" during playback closes it at the
 * seek's `fromTime` and opens a new one at its target, so skipped footage
 * never counts as watched (#682); seeks while paused change nothing. A
 * "restored" discards an open range: the preceding session never confirmed
 * its end (#728). Empty or backwards ranges are dropped.
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
      case "restored":
        openStart = null;
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

/**
 * Unique watched media seconds inside [startAt ?? 0, stopAt ?? duration].
 * Overlaps count once; gaps remain unwatched, however small. The fraction is
 * absent until the media duration and the resulting window are finite and
 * positive. An explicit stopAt still bounds seconds before duration is known.
 */
export function computeWatchedCoverage(
  ranges: [number, number][],
  options: { startAt?: number; stopAt?: number; duration?: number } = {},
): { watchedSeconds: number; watchedFraction?: number } {
  const start = options.startAt ?? 0;
  const knownDuration =
    options.duration !== undefined &&
    Number.isFinite(options.duration) &&
    options.duration > 0;
  const end = options.stopAt ?? (knownDuration ? options.duration : undefined);
  if (
    !Number.isFinite(start) ||
    (end !== undefined && (!Number.isFinite(end) || end <= start))
  ) {
    return { watchedSeconds: 0 };
  }

  const clipped = ranges
    .map(([from, to]): [number, number] => [
      Math.max(start, from),
      Math.min(end ?? Infinity, to),
    ])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let watchedSeconds = 0;
  let previousEnd = start;
  for (const [from, to] of clipped) {
    watchedSeconds += Math.max(0, to - Math.max(previousEnd, from));
    previousEnd = Math.max(previousEnd, to);
  }

  if (!knownDuration || end === undefined) return { watchedSeconds };
  return {
    watchedSeconds,
    watchedFraction: Math.min(1, Math.max(0, watchedSeconds / (end - start))),
  };
}

/**
 * Playback milestones in a VideoEvent log (#710): the first `play`, and the
 * first time playback reached the end of the clip — a `stopAt` or the file's
 * `ended`, the events `submitOnComplete` advances on. Conditions can't search
 * the log, so the saved record carries these for gating, e.g. a Next button
 * that appears once the video has started. The log only grows, so neither
 * changes once set. Each is absent until it happens.
 */
export function playbackMilestones(
  events: VideoEvent[],
): Pick<VideoPlaybackRecord, "firstPlay" | "firstEnd"> {
  const firstPlay = events.find(
    (e): e is NonNullable<VideoPlaybackRecord["firstPlay"]> =>
      e.type === "play",
  );
  const firstEnd = events.find(
    (e): e is NonNullable<VideoPlaybackRecord["firstEnd"]> =>
      e.type === "ended" || e.type === "stopAt",
  );
  return { ...(firstPlay && { firstPlay }), ...(firstEnd && { firstEnd }) };
}
