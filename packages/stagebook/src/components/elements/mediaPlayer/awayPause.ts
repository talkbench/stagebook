/**
 * Pausing media while the participant is away from the page (#844).
 *
 * This module holds the bookkeeping: which page states count as away, the
 * open automatic pause, its counters and the log cap. It owns no timers,
 * event listeners, or I/O; MediaPlayer drives it from the page's
 * visibility and focus events and from its own transport events.
 */
import type { VideoEvent } from "../../../schemas/mediaPlayerRecord.js";

export const AWAY_TRIGGERS = ["hidden", "unfocused"] as const;
export type AwayTrigger = (typeof AWAY_TRIGGERS)[number];

/** An absence shorter than this changes only the counters (#844). */
export const AWAY_LOG_THRESHOLD_MS = 1000;

/** Automatic pause/play pairs logged per player before only counting. */
export const AWAY_LOG_CAP = 50;

export interface AwayPauseStats {
  /** Automatic pauses, logged or not. */
  awayPauseCount: number;
  /** Wall time spent paused because the participant was away. */
  awayPausedSeconds: number;
  /** Returns where the browser refused to resume playback. */
  resumeBlockedCount: number;
  /** Away pauses of at least a second not logged because of the cap. */
  awayPausesDropped: number;
}

export interface AwayEpisode {
  reason: AwayTrigger;
  /** Media and stage time when playback was paused. */
  videoTime: number;
  stageTimeElapsed: number;
  /**
   * `pending` until the pause is logged (`logged`) or will never be:
   * `silent` for a sub-second absence or once the cap is reached.
   */
  log: "pending" | "logged" | "silent";
}

/**
 * Why the page counts as away, or null when it doesn't. A hidden page also
 * lacks focus, so `unfocused` covers it too, reported as the more specific
 * `hidden`. `focused` is `document.hasFocus()`, which stays true while focus
 * is inside a frame on the page, such as a YouTube player's own controls.
 */
export function awayReason(
  triggers: readonly AwayTrigger[],
  page: { hidden: boolean; focused: boolean },
): AwayTrigger | null {
  if (triggers.length === 0) return null;
  if (page.hidden) return "hidden";
  if (!page.focused && triggers.includes("unfocused")) return "unfocused";
  return null;
}

/** Automatic pauses already in a restored log, so the cap continues. */
export function loggedAwayPauses(
  events: readonly VideoEvent[] | undefined,
): number {
  return (events ?? []).filter(
    (event) =>
      event.type === "pause" &&
      (event.reason === "hidden" || event.reason === "unfocused"),
  ).length;
}

function count(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function seconds(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

interface AwayPauseOptions {
  /** Monotonic milliseconds, normally performance.now(). */
  now: () => number;
  initial?: {
    stats?: Partial<AwayPauseStats>;
    /** Automatic pauses already logged, from {@link loggedAwayPauses}. */
    logged?: number;
  };
}

export function createAwayPause({ now, initial }: AwayPauseOptions) {
  const stats: AwayPauseStats = {
    awayPauseCount: count(initial?.stats?.awayPauseCount),
    awayPausedSeconds: seconds(initial?.stats?.awayPausedSeconds),
    resumeBlockedCount: count(initial?.stats?.resumeBlockedCount),
    awayPausesDropped: count(initial?.stats?.awayPausesDropped),
  };
  let logged = count(initial?.logged);
  let episode: AwayEpisode | null = null;
  let startedAt = 0;
  let settledAt = 0;

  const settle = () => {
    if (!episode) return;
    const time = now();
    if (!Number.isFinite(time) || time <= settledAt) return;
    stats.awayPausedSeconds += (time - settledAt) / 1000;
    settledAt = time;
  };

  return {
    episode: (): Readonly<AwayEpisode> | null => episode,
    /** Milliseconds since the open automatic pause began; 0 when none. */
    awayMs: () => (episode ? Math.max(0, now() - startedAt) : 0),
    /** Record an automatic pause. Ignored while one is already open. */
    begin(reason: AwayTrigger, videoTime: number, stageTimeElapsed: number) {
      if (episode) return;
      stats.awayPauseCount += 1;
      const time = now();
      startedAt = settledAt = Number.isFinite(time) ? time : 0;
      episode = { reason, videoTime, stageTimeElapsed, log: "pending" };
    },
    /**
     * Claim a log slot for the open pause. False when it is already decided,
     * or once the cap is reached, which counts it as dropped.
     */
    claimLog(): boolean {
      if (!episode || episode.log !== "pending") return false;
      if (logged >= AWAY_LOG_CAP) {
        episode.log = "silent";
        stats.awayPausesDropped += 1;
        return false;
      }
      logged += 1;
      episode.log = "logged";
      return true;
    },
    /** A sub-second absence: the open pause is never logged. */
    skipLog() {
      if (episode?.log === "pending") episode.log = "silent";
    },
    /** Playback resumed, by the player or the participant. */
    end() {
      settle();
      episode = null;
    },
    blocked() {
      stats.resumeBlockedCount += 1;
    },
    snapshot(): AwayPauseStats {
      settle();
      return { ...stats };
    },
  };
}

export type AwayPause = ReturnType<typeof createAwayPause>;
