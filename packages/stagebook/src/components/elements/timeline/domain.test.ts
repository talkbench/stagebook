import { describe, it, expect } from "vitest";
import { clampToDomain, domainSpan, timelineDomain } from "./domain.js";
import type { PlaybackHandle } from "../../playback/PlaybackHandle.js";

function handle(
  duration: number,
  bounds?: { start: number; end: number },
): PlaybackHandle {
  return {
    play() {},
    pause() {},
    seekTo() {},
    getCurrentTime: () => 0,
    getDuration: () => duration,
    ...(bounds && { getBounds: () => bounds }),
    isPaused: () => true,
    isYouTube: false,
    channelCount: 0,
    peaks: [],
    peaksVersion: 0,
    requestWaveformCapture() {},
    setChannelMuted() {},
    isChannelMuted: () => false,
  };
}

describe("timelineDomain", () => {
  it("spans the whole file when the handle reports no bounds", () => {
    expect(timelineDomain(handle(60))).toEqual({ start: 0, end: 60 });
  });

  it("spans the player's window when it reports one (#675)", () => {
    expect(timelineDomain(handle(175, { start: 60, end: 90 }))).toEqual({
      start: 60,
      end: 90,
    });
  });

  it("caps an unbounded window end at the media duration", () => {
    // A player with only startAt reports end = Infinity until it knows the
    // duration; the Timeline needs a finite end to lay out.
    expect(timelineDomain(handle(175, { start: 60, end: Infinity }))).toEqual({
      start: 60,
      end: 175,
    });
  });

  it("caps a window that runs past the end of the file", () => {
    expect(timelineDomain(handle(80, { start: 60, end: 90 }))).toEqual({
      start: 60,
      end: 80,
    });
  });

  it("falls back to the whole file when the window is empty or inverted", () => {
    expect(timelineDomain(handle(50, { start: 60, end: 90 }))).toEqual({
      start: 0,
      end: 50,
    });
    expect(timelineDomain(handle(175, { start: 90, end: 60 }))).toEqual({
      start: 0,
      end: 175,
    });
  });

  it("is empty until the media duration is known", () => {
    expect(timelineDomain(null)).toEqual({ start: 0, end: 0 });
    expect(timelineDomain(handle(0))).toEqual({ start: 0, end: 0 });
    expect(timelineDomain(handle(NaN, { start: 60, end: 90 }))).toEqual({
      start: 0,
      end: 0,
    });
    expect(timelineDomain(handle(Infinity))).toEqual({ start: 0, end: 0 });
  });
});

describe("domainSpan / clampToDomain", () => {
  const domain = { start: 60, end: 90 };

  it("measures the domain's length", () => {
    expect(domainSpan(domain)).toBe(30);
  });

  it("clamps times into the domain", () => {
    expect(clampToDomain(10, domain)).toBe(60);
    expect(clampToDomain(75, domain)).toBe(75);
    expect(clampToDomain(120, domain)).toBe(90);
  });
});
