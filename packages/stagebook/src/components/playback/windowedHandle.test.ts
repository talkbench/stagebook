import { describe, it, expect } from "vitest";
import { seekWindow, withSeekWindow } from "./windowedHandle.js";
import type { PlaybackHandle } from "./PlaybackHandle.js";

function recordingHandle() {
  const seeks: number[] = [];
  const state = { peaksVersion: 0, channelCount: 0 };
  const handle: PlaybackHandle = {
    play() {},
    pause() {},
    seekTo: (s) => seeks.push(s),
    getCurrentTime: () => 42,
    getDuration: () => 175,
    isPaused: () => true,
    isYouTube: false,
    get channelCount() {
      return state.channelCount;
    },
    peaks: [],
    get peaksVersion() {
      return state.peaksVersion;
    },
    durationVersion: 3,
    requestWaveformCapture() {},
    setChannelMuted() {},
    isChannelMuted: (c) => c === 1,
  };
  return { handle, seeks, state };
}

describe("withSeekWindow (#675)", () => {
  it("clamps seeks into the window", () => {
    const { handle, seeks } = recordingHandle();
    const windowed = withSeekWindow(handle, () => ({ start: 60, end: 90 }));
    windowed.seekTo(10);
    windowed.seekTo(75);
    windowed.seekTo(120);
    expect(seeks).toEqual([60, 75, 90]);
  });

  it("reads the window on every seek, so a changed window applies", () => {
    const { handle, seeks } = recordingHandle();
    let bounds = { start: 60, end: 90 };
    const windowed = withSeekWindow(handle, () => bounds);
    windowed.seekTo(0);
    bounds = { start: 30, end: 90 };
    windowed.seekTo(0);
    expect(seeks).toEqual([60, 30]);
  });

  it("leaves an open end unclamped", () => {
    const { handle, seeks } = recordingHandle();
    const windowed = withSeekWindow(handle, () => ({
      start: 60,
      end: Infinity,
    }));
    windowed.seekTo(500);
    expect(seeks).toEqual([500]);
  });

  it("reports the window", () => {
    const { handle } = recordingHandle();
    const windowed = withSeekWindow(handle, () => ({ start: 60, end: 90 }));
    expect(windowed.getBounds?.()).toEqual({ start: 60, end: 90 });
  });

  it("passes everything else through, including live getters", () => {
    const { handle, state } = recordingHandle();
    const windowed = withSeekWindow(handle, () => ({ start: 60, end: 90 }));
    expect(windowed.getCurrentTime()).toBe(42);
    expect(windowed.getDuration()).toBe(175);
    expect(windowed.durationVersion).toBe(3);
    expect(windowed.isChannelMuted(1)).toBe(true);
    // Peaks are mutated in place and versioned; a snapshot would freeze them.
    state.peaksVersion = 7;
    state.channelCount = 2;
    expect(windowed.peaksVersion).toBe(7);
    expect(windowed.channelCount).toBe(2);
  });
});

describe("seekWindow (#675)", () => {
  const bounded = { startAt: 60, stopAt: 90, allowScrubOutsideBounds: false };

  it("is [startAt, stopAt]", () => {
    expect(seekWindow(bounded, 175)).toEqual({ start: 60, end: 90 });
  });

  it("is the whole file with allowScrubOutsideBounds", () => {
    expect(
      seekWindow({ ...bounded, allowScrubOutsideBounds: true }, 175),
    ).toEqual({ start: 0, end: 175 });
  });

  it("defaults a missing startAt to 0 and a missing stopAt to the end", () => {
    const flags = { allowScrubOutsideBounds: false };
    expect(seekWindow({ ...flags, startAt: 60 }, 175)).toEqual({
      start: 60,
      end: 175,
    });
    expect(seekWindow({ ...flags, stopAt: 90 }, 175)).toEqual({
      start: 0,
      end: 90,
    });
  });

  it("leaves the end open while the duration is unknown", () => {
    const startOnly = { startAt: 60, allowScrubOutsideBounds: false };
    for (const duration of [NaN, 0, Infinity]) {
      expect(seekWindow(startOnly, duration)).toEqual({
        start: 60,
        end: Infinity,
      });
    }
    expect(seekWindow(bounded, NaN)).toEqual({ start: 60, end: 90 });
  });

  it("caps a window that runs past the end of the file", () => {
    expect(seekWindow(bounded, 80)).toEqual({ start: 60, end: 80 });
  });

  it("falls back to the whole file for an empty window, as the Timeline does", () => {
    // startAt past the end of the file (a shorter recording than authored,
    // or an infinite startAt) would otherwise send every seek to startAt.
    expect(seekWindow(bounded, 50)).toEqual({ start: 0, end: 50 });
    expect(
      seekWindow({ startAt: Infinity, allowScrubOutsideBounds: false }, 50),
    ).toEqual({ start: 0, end: 50 });
    expect(
      seekWindow({ startAt: Infinity, allowScrubOutsideBounds: false }, NaN),
    ).toEqual({ start: 0, end: Infinity });
  });
});
