import { expect, test, vi } from "vitest";
import { createPlaybackVisibility } from "./playbackVisibility.js";

test("counts overlapping hidden and unfocused wall time only while playing", () => {
  let time = 0;
  const visibility = createPlaybackVisibility({
    now: () => time,
    hidden: false,
    focused: true,
  });
  time = 10_000;
  visibility.setVisibility(true);
  time = 20_000;
  visibility.setFocused(false);
  time = 30_000;
  visibility.setPlaying(true);
  time = 35_000;
  visibility.setVisibility(false);
  time = 38_000;
  visibility.setFocused(true);
  time = 40_000;
  visibility.setVisibility(true);
  time = 42_000;
  visibility.setPlaying(false);
  time = 50_000;
  visibility.setVisibility(false);
  time = 60_000;
  expect(visibility.snapshot()).toEqual({
    hiddenPlaybackSeconds: 7,
    unfocusedPlaybackSeconds: 8,
    visibilityChangesDuringPlayback: 2,
  });
});

test("snapshots include the running interval once and stay detached", () => {
  let time = 0;
  const visibility = createPlaybackVisibility({
    now: () => time,
    hidden: true,
    focused: false,
  });
  visibility.setPlaying(true);
  time = 1500;
  const first = visibility.snapshot();
  expect(first.hiddenPlaybackSeconds).toBe(1.5);
  expect(visibility.snapshot()).toEqual(first);
  time = 2250;
  expect(visibility.snapshot().hiddenPlaybackSeconds).toBe(2.25);
  expect(first.hiddenPlaybackSeconds).toBe(1.5);
  first.hiddenPlaybackSeconds = 500;
  expect(visibility.snapshot().hiddenPlaybackSeconds).toBe(2.25);
});

test("duplicate state reports do not count visibility changes or restart intervals", () => {
  let time = 0;
  const visibility = createPlaybackVisibility({
    now: () => time,
    hidden: true,
    focused: false,
  });
  visibility.setPlaying(true);
  time = 1000;
  visibility.setVisibility(true);
  visibility.setFocused(false);
  visibility.setPlaying(true);
  time = 3000;
  expect(visibility.snapshot()).toEqual({
    hiddenPlaybackSeconds: 3,
    unfocusedPlaybackSeconds: 3,
    visibilityChangesDuringPlayback: 0,
  });
});

test("waiting, seeking, and paused gaps can be excluded without changing media coverage", () => {
  let time = 0;
  const visibility = createPlaybackVisibility({
    now: () => time,
    hidden: true,
    focused: false,
  });
  // The caller begins only on observed playing, not the earlier play request.
  time = 4000;
  visibility.setPlaying(true);
  time = 6500;
  visibility.setPlaying(false);
  time = 20_000;
  visibility.setPlaying(true);
  time = 21_500;
  visibility.setPlaying(false);
  time = 40_000;
  expect(visibility.snapshot()).toEqual({
    hiddenPlaybackSeconds: 4,
    unfocusedPlaybackSeconds: 4,
    visibilityChangesDuringPlayback: 0,
  });
});

test("restores valid totals without assuming playback continued between mounts", () => {
  let time = 50_000;
  const initial = {
    hiddenPlaybackSeconds: 12.25,
    unfocusedPlaybackSeconds: 18,
    visibilityChangesDuringPlayback: 4,
  };
  const visibility = createPlaybackVisibility({
    now: () => time,
    hidden: true,
    focused: false,
    initial,
  });
  time = 100_000;
  expect(visibility.snapshot()).toEqual(initial);
  visibility.setPlaying(true);
  time = 102_000;
  visibility.setVisibility(false);
  expect(visibility.snapshot()).toEqual({
    hiddenPlaybackSeconds: 14.25,
    unfocusedPlaybackSeconds: 20,
    visibilityChangesDuringPlayback: 5,
  });
  expect(initial.hiddenPlaybackSeconds).toBe(12.25);
});

test.each([NaN, Infinity, -1])(
  "ignores invalid restored measurements %s",
  (invalid) => {
    const visibility = createPlaybackVisibility({
      now: () => 0,
      hidden: false,
      focused: true,
      initial: {
        hiddenPlaybackSeconds: invalid,
        unfocusedPlaybackSeconds: invalid,
        visibilityChangesDuringPlayback: invalid,
      },
    });
    expect(visibility.snapshot()).toEqual({
      hiddenPlaybackSeconds: 0,
      unfocusedPlaybackSeconds: 0,
      visibilityChangesDuringPlayback: 0,
    });
  },
);

test("partial historical totals remain usable but fractional event counts do not", () => {
  const visibility = createPlaybackVisibility({
    now: () => 0,
    hidden: false,
    focused: true,
    initial: {
      hiddenPlaybackSeconds: 1.25,
      visibilityChangesDuringPlayback: 1.5,
    },
  });
  expect(visibility.snapshot()).toEqual({
    hiddenPlaybackSeconds: 1.25,
    unfocusedPlaybackSeconds: 0,
    visibilityChangesDuringPlayback: 0,
  });
});

test("a backward or invalid clock reading cannot subtract or double-count time", () => {
  let time = 0;
  const visibility = createPlaybackVisibility({
    now: () => time,
    hidden: true,
    focused: false,
  });
  visibility.setPlaying(true);
  time = 2000;
  expect(visibility.snapshot().hiddenPlaybackSeconds).toBe(2);
  time = 1000;
  expect(visibility.snapshot().hiddenPlaybackSeconds).toBe(2);
  time = NaN;
  expect(visibility.snapshot().hiddenPlaybackSeconds).toBe(2);
  time = 2500;
  expect(visibility.snapshot().hiddenPlaybackSeconds).toBe(2.5);
});

test("creates no timers while tracking or snapshotting", () => {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
  try {
    const visibility = createPlaybackVisibility({
      now: () => performance.now(),
      hidden: true,
      focused: false,
    });
    visibility.setPlaying(true);
    vi.advanceTimersByTime(3000);
    expect(visibility.snapshot().hiddenPlaybackSeconds).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
