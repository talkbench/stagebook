import { describe, it, expect } from "vitest";
import { atClipEnd, clipWindow } from "./clipEnd.js";

describe("clipWindow (#684)", () => {
  it("is [startAt, stopAt] — the clip as authored", () => {
    expect(clipWindow(60, 90, 175)).toEqual({ start: 60, end: 90 });
  });

  it("defaults to the whole file", () => {
    expect(clipWindow(undefined, undefined, 175)).toEqual({
      start: 0,
      end: 175,
    });
    expect(clipWindow(60, undefined, 175)).toEqual({ start: 60, end: 175 });
  });

  it("has an open end until the duration is known", () => {
    expect(clipWindow(60, undefined, NaN)).toEqual({
      start: 60,
      end: Infinity,
    });
  });
});

describe("atClipEnd (#684)", () => {
  const clip = { start: 60, end: 90 };

  it("is true at or past the end", () => {
    expect(atClipEnd(90, false, clip)).toBe(true);
    expect(atClipEnd(90.2, false, clip)).toBe(true);
  });

  it("is false inside the clip", () => {
    expect(atClipEnd(60, false, clip)).toBe(false);
    expect(atClipEnd(89.9, false, clip)).toBe(false);
  });

  it("trusts the player's ended state just short of the end", () => {
    // YouTube can report a time slightly short of its duration at the end.
    expect(atClipEnd(89.8, true, clip)).toBe(true);
  });

  it("ignores a stale ended state once the playhead has moved back", () => {
    expect(atClipEnd(70, true, clip)).toBe(false);
  });

  it("is never true for an open end", () => {
    expect(atClipEnd(500, false, { start: 0, end: Infinity })).toBe(false);
    expect(atClipEnd(500, true, { start: 0, end: Infinity })).toBe(false);
  });
});
