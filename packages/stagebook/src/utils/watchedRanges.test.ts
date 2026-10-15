import { describe, it, expect } from "vitest";
import {
  computeWatchedCoverage,
  computeWatchedRanges,
  endsMidPlayback,
  playbackMilestones,
} from "./watchedRanges.js";
import type { VideoEvent } from "../components/elements/MediaPlayer.js";

function ev(
  type: Exclude<VideoEvent["type"], "seek" | "speed">,
  videoTime: number,
): VideoEvent {
  return { type, videoTime, stageTimeElapsed: 0 };
}

describe("computeWatchedRanges", () => {
  it("returns empty array for no events", () => {
    expect(computeWatchedRanges([])).toEqual([]);
  });

  it("returns empty array for a lone play with no closing event", () => {
    expect(computeWatchedRanges([ev("play", 0)])).toEqual([]);
  });

  it("returns empty array for pause with no preceding play", () => {
    expect(computeWatchedRanges([ev("pause", 10)])).toEqual([]);
  });

  it("returns one interval for play → pause", () => {
    expect(computeWatchedRanges([ev("play", 5), ev("pause", 15)])).toEqual([
      [5, 15],
    ]);
  });

  it("returns one interval for play → ended", () => {
    expect(computeWatchedRanges([ev("play", 0), ev("ended", 30)])).toEqual([
      [0, 30],
    ]);
  });

  it("returns multiple disjoint intervals", () => {
    expect(
      computeWatchedRanges([
        ev("play", 0),
        ev("pause", 10),
        ev("play", 20),
        ev("pause", 30),
      ]),
    ).toEqual([
      [0, 10],
      [20, 30],
    ]);
  });

  it("merges overlapping intervals", () => {
    // Watched 0-15 and 10-25 → merged to 0-25
    expect(
      computeWatchedRanges([
        ev("play", 0),
        ev("pause", 15),
        ev("play", 10),
        ev("pause", 25),
      ]),
    ).toEqual([[0, 25]]);
  });

  it("merges adjacent intervals (touching endpoints)", () => {
    expect(
      computeWatchedRanges([
        ev("play", 0),
        ev("pause", 10),
        ev("play", 10),
        ev("pause", 20),
      ]),
    ).toEqual([[0, 20]]);
  });

  it("merges three overlapping intervals into one", () => {
    expect(
      computeWatchedRanges([
        ev("play", 0),
        ev("pause", 20),
        ev("play", 5),
        ev("pause", 30),
        ev("play", 15),
        ev("pause", 40),
      ]),
    ).toEqual([[0, 40]]);
  });

  it("excludes an open play (no closing pause/ended) at the end", () => {
    // Disconnected mid-playback — open interval not included
    expect(
      computeWatchedRanges([
        ev("play", 0),
        ev("pause", 10),
        ev("play", 20), // never closed
      ]),
    ).toEqual([[0, 10]]);
  });

  it("closes on stopAt, ignoring the pause that follows it", () => {
    expect(
      computeWatchedRanges([ev("play", 0), ev("stopAt", 15), ev("pause", 15)]),
    ).toEqual([[0, 15]]);
  });

  it("handles play → ended followed by another play → pause", () => {
    expect(
      computeWatchedRanges([
        ev("play", 0),
        ev("ended", 30),
        ev("play", 0),
        ev("pause", 20),
      ]),
    ).toEqual([[0, 30]]);
  });

  describe("seeks during playback (#682)", () => {
    function seek(fromTime: number, videoTime: number): VideoEvent {
      return { type: "seek", videoTime, fromTime, stageTimeElapsed: 0 };
    }

    it("closes the range at fromTime and reopens it at the target (backward seek)", () => {
      // Play from 30, seek back from 40 to 10, pause at 12.
      expect(
        computeWatchedRanges([ev("play", 30), seek(40, 10), ev("pause", 12)]),
      ).toEqual([
        [10, 12],
        [30, 40],
      ]);
    });

    it("doesn't count skipped footage as watched (forward seek)", () => {
      expect(
        computeWatchedRanges([ev("play", 0), seek(5, 50), ev("pause", 55)]),
      ).toEqual([
        [0, 5],
        [50, 55],
      ]);
    });

    it("ignores seeks while paused", () => {
      // The next range starts at the next play, even where it isn't the
      // seek's target (a jump the log didn't see).
      expect(
        computeWatchedRanges([
          ev("play", 0),
          ev("pause", 5),
          seek(5, 50),
          ev("play", 70),
          ev("pause", 75),
        ]),
      ).toEqual([
        [0, 5],
        [70, 75],
      ]);
    });

    it("keeps a range open across successive seeks", () => {
      expect(
        computeWatchedRanges([
          ev("play", 0),
          seek(2, 20),
          seek(22, 40),
          ev("ended", 45),
        ]),
      ).toEqual([
        [0, 2],
        [20, 22],
        [40, 45],
      ]);
    });

    it("drops an empty range, e.g. a scrub whose pause lands on the target", () => {
      // The scrub bar pauses, then seeks; the pause reads the target time.
      expect(
        computeWatchedRanges([ev("play", 0), seek(5, 50), ev("pause", 50)]),
      ).toEqual([[0, 5]]);
    });
  });

  it("never returns a backwards range", () => {
    // An unlogged jump (older logs, before seeks were recorded) pairs a
    // play with a pause earlier in the file.
    expect(computeWatchedRanges([ev("play", 40), ev("pause", 12)])).toEqual([]);
  });

  it("closes an open range when the player is removed (#677)", () => {
    expect(
      computeWatchedRanges([
        ev("play", 15.28),
        ev("pause", 20),
        ev("play", 20),
        ev("removed", 24.5),
      ]),
    ).toEqual([[15.28, 24.5]]);
  });

  it("drops an unfinished range at restoration without losing closed ranges", () => {
    expect(
      computeWatchedRanges([
        ev("play", 0),
        ev("pause", 5),
        ev("play", 10),
        ev("restored", 20),
        ev("pause", 22),
        ev("play", 30),
        ev("pause", 35),
      ]),
    ).toEqual([
      [0, 5],
      [30, 35],
    ]);
  });

  it("returns intervals sorted by start time", () => {
    // Events arrive out of order (e.g. after scrub)
    expect(
      computeWatchedRanges([
        ev("play", 50),
        ev("pause", 60),
        ev("play", 10),
        ev("pause", 20),
      ]),
    ).toEqual([
      [10, 20],
      [50, 60],
    ]);
  });
});

describe("computeWatchedCoverage (#719)", () => {
  it("totals all ranges without filling even a small pause gap", () => {
    const coverage = computeWatchedCoverage(
      [
        [0, 1.8],
        [1.806, 4],
      ],
      { duration: 4 },
    );
    expect(coverage.watchedSeconds).toBeCloseTo(3.994);
    expect(coverage.watchedFraction).toBeCloseTo(3.994 / 4);
    expect(coverage.watchedFraction).toBeLessThan(1);
  });

  it("counts replayed footage once even with overlapping unsorted input", () => {
    const ranges: [number, number][] = [
      [6, 10],
      [0, 8],
      [2, 4],
      [10, 12],
    ];
    const original = structuredClone(ranges);
    expect(computeWatchedCoverage(ranges, { duration: 12 })).toEqual({
      watchedSeconds: 12,
      watchedFraction: 1,
    });
    expect(ranges).toEqual(original);
  });

  it("does not count footage skipped by a meaningful forward seek", () => {
    const ranges = computeWatchedRanges([
      ev("play", 0),
      { type: "seek", videoTime: 50, fromTime: 5, stageTimeElapsed: 0 },
      ev("ended", 60),
    ]);
    expect(computeWatchedCoverage(ranges, { duration: 60 })).toEqual({
      watchedSeconds: 15,
      watchedFraction: 0.25,
    });
  });

  it("clips coverage to a nonzero authored window", () => {
    expect(
      computeWatchedCoverage(
        [
          [0, 15],
          [18, 40],
        ],
        { startAt: 10, stopAt: 20, duration: 100 },
      ),
    ).toEqual({ watchedSeconds: 7, watchedFraction: 0.7 });
  });

  it("ignores ranges outside the authored window", () => {
    expect(
      computeWatchedCoverage(
        [
          [0, 5],
          [30, 40],
        ],
        { startAt: 10, stopAt: 20, duration: 100 },
      ),
    ).toEqual({ watchedSeconds: 0, watchedFraction: 0 });
  });

  it("uses the media duration when stopAt is absent", () => {
    expect(
      computeWatchedCoverage([[5, 25]], { startAt: 10, duration: 20 }),
    ).toEqual({ watchedSeconds: 10, watchedFraction: 1 });
  });

  it("clips negative footage and playback past the end", () => {
    expect(computeWatchedCoverage([[-5, 30]], { duration: 20 })).toEqual({
      watchedSeconds: 20,
      watchedFraction: 1,
    });
  });

  it.each([undefined, NaN, Infinity, -Infinity, 0, -10])(
    "omits the fraction when duration is unavailable (%s)",
    (duration) => {
      expect(
        computeWatchedCoverage(
          [
            [0, 5],
            [10, 20],
          ],
          { duration },
        ),
      ).toEqual({ watchedSeconds: 15 });
    },
  );

  it("can count seconds inside an explicit window before duration is known", () => {
    expect(
      computeWatchedCoverage([[0, 30]], { startAt: 10, stopAt: 20 }),
    ).toEqual({ watchedSeconds: 10 });
  });

  it.each([
    { startAt: 20, stopAt: 10, duration: 30 },
    { startAt: 10, stopAt: 10, duration: 30 },
    { startAt: 30, duration: 20 },
  ])("omits the fraction for an empty or inverted window: %j", (options) => {
    expect(computeWatchedCoverage([[0, 40]], options)).toEqual({
      watchedSeconds: 0,
    });
  });

  it("reports zero coverage for an empty log with a known window", () => {
    expect(computeWatchedCoverage([], { duration: 20 })).toEqual({
      watchedSeconds: 0,
      watchedFraction: 0,
    });
  });

  it("measures media seconds independently of playback speed", () => {
    const ranges = computeWatchedRanges([
      ev("play", 0),
      {
        type: "speed",
        videoTime: 5,
        playbackRate: 2,
        stageTimeElapsed: 5,
      },
      { type: "pause", videoTime: 15, stageTimeElapsed: 10 },
    ]);
    expect(computeWatchedCoverage(ranges, { duration: 20 })).toEqual({
      watchedSeconds: 15,
      watchedFraction: 0.75,
    });
  });
});

describe("endsMidPlayback (#677)", () => {
  const seek: VideoEvent = {
    type: "seek",
    videoTime: 50,
    fromTime: 5,
    stageTimeElapsed: 0,
  };
  const speed: VideoEvent = {
    type: "speed",
    videoTime: 5,
    stageTimeElapsed: 0,
    playbackRate: 1.5,
  };

  it("is true after a play, through seeks and speed changes", () => {
    expect(endsMidPlayback([ev("play", 0)])).toBe(true);
    expect(endsMidPlayback([ev("play", 0), seek])).toBe(true);
    expect(endsMidPlayback([ev("play", 0), speed])).toBe(true);
  });

  it("is false before playback starts and once it is closed", () => {
    expect(endsMidPlayback([])).toBe(false);
    expect(endsMidPlayback([seek])).toBe(false);
    for (const type of [
      "pause",
      "ended",
      "stopAt",
      "removed",
      "restored",
    ] as const) {
      expect(endsMidPlayback([ev("play", 0), ev(type, 5)])).toBe(false);
    }
  });
});

describe("playbackMilestones (#710)", () => {
  it("has neither before playback", () => {
    expect(playbackMilestones([])).toStrictEqual({});
    expect(
      playbackMilestones([
        { type: "seek", videoTime: 10, fromTime: 0, stageTimeElapsed: 0 },
        {
          type: "speed",
          videoTime: 10,
          playbackRate: 1.5,
          stageTimeElapsed: 0,
        },
        ev("pause", 10),
      ]),
    ).toStrictEqual({});
  });

  it("keeps the first play when playback resumes", () => {
    const first = ev("play", 4);
    expect(
      playbackMilestones([
        { type: "seek", videoTime: 4, fromTime: 0, stageTimeElapsed: 0 },
        first,
        ev("pause", 9),
        ev("play", 9),
      ]),
    ).toEqual({ firstPlay: first });
  });

  it("takes the first end, whether stopAt or the file's end", () => {
    const stop = ev("stopAt", 60);
    expect(
      playbackMilestones([ev("play", 0), stop, ev("play", 0), ev("ended", 100)])
        .firstEnd,
    ).toBe(stop);
    const ended = ev("ended", 100);
    expect(playbackMilestones([ev("play", 0), ended]).firstEnd).toBe(ended);
  });

  it("does not count leaving the page as reaching the end", () => {
    expect(
      playbackMilestones([ev("play", 0), ev("removed", 30)]),
    ).not.toHaveProperty("firstEnd");
  });

  it("preserves first milestones across a restored playback session", () => {
    const firstPlay = ev("play", 0);
    const firstEnd = ev("ended", 30);
    expect(
      playbackMilestones([
        firstPlay,
        firstEnd,
        ev("restored", 30),
        ev("play", 0),
        ev("ended", 30),
      ]),
    ).toEqual({ firstPlay, firstEnd });
    expect(playbackMilestones([ev("restored", 30)])).toEqual({});
  });
});
