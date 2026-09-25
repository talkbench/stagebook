// The span of media time a Timeline shows and lets participants mark (#675).
// No React/DOM deps.
import type { PlaybackHandle } from "../../playback/PlaybackHandle.js";

/**
 * A span of media time, in seconds from the start of the media file. Every
 * time the Timeline handles — playhead, marks, viewport — is in media time;
 * the domain only says which part of the file is reachable.
 */
export interface TimeDomain {
  start: number;
  end: number;
}

const EMPTY: TimeDomain = { start: 0, end: 0 };

/**
 * The domain for a Timeline attached to `handle`: the player's window when it
 * reports one (`getBounds`), otherwise the whole file. Empty until the media
 * duration is known, matching how the Timeline treated a zero duration.
 */
export function timelineDomain(
  handle: PlaybackHandle | null | undefined,
): TimeDomain {
  if (!handle) return EMPTY;
  const duration = handle.getDuration();
  if (!Number.isFinite(duration) || duration <= 0) return EMPTY;
  const bounds = handle.getBounds?.();
  const start = Math.max(0, Math.min(duration, bounds?.start ?? 0));
  const end = Math.max(0, Math.min(duration, bounds?.end ?? duration));
  // An empty or inverted window (e.g. startAt past the end of the file)
  // can't be shown; fall back to the whole file rather than a blank track.
  return end > start ? { start, end } : { start: 0, end: duration };
}

export function domainSpan(domain: TimeDomain): number {
  return domain.end - domain.start;
}

export function clampToDomain(time: number, domain: TimeDomain): number {
  return Math.max(domain.start, Math.min(domain.end, time));
}
