import { describe, it, expect } from "vitest";
import { computeWatchedRanges, endsMidPlayback } from "./watchedRanges.js";
import type { VideoEvent } from "../components/elements/MediaPlayer.js";

function ev(type: VideoEvent["type"], videoTime: number): VideoEvent {
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

  it("closes an open range at stageEnd (#677)", () => {
    expect(
      computeWatchedRanges([
        ev("play", 15.28),
        ev("pause", 20),
        ev("play", 20),
        ev("stageEnd", 24.5),
      ]),
    ).toEqual([[15.28, 24.5]]);
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
    for (const type of ["pause", "ended", "stopAt", "stageEnd"] as const) {
      expect(endsMidPlayback([ev("play", 0), ev(type, 5)])).toBe(false);
    }
  });
});
