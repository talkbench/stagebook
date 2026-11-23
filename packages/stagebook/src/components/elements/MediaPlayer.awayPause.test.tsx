// @vitest-environment jsdom
// Pausing while the participant is away, and resuming on return (#844).
// jsdom's <video> never plays, so play()/pause() are stubbed to flip
// `paused` and fire the events a browser would, and the page's visibility
// and focus are driven by hand.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MediaPlayer,
  type MediaPlayerProps,
  type VideoPlaybackRecord,
} from "./MediaPlayer.js";
import { PlaybackProvider, usePlayback } from "../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../playback/PlaybackHandle.js";
import { AWAY_LOG_CAP } from "./mediaPlayer/awayPause.js";

let handle: PlaybackHandle | undefined;
function Probe() {
  handle = usePlayback("clip");
  return null;
}

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;
let saves: VideoPlaybackRecord[];
let now: number;
let hidden: boolean;
let focused: boolean;
const htmlPlay = vi.fn<(this: HTMLMediaElement) => Promise<void>>();
const htmlPause = vi.fn<(this: HTMLMediaElement) => void>();

const video = () => container.querySelector("video")!;
const last = () => saves.at(-1)!;
const tail = (n: number) =>
  last()
    .events.slice(-n)
    .map(({ type, videoTime, fromTime, reason }) => ({
      type,
      videoTime,
      ...(fromTime !== undefined && { fromTime }),
      ...(reason !== undefined && { reason }),
    }));
const notice = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="mediaPlayer-awayResume"]',
  );

function setPaused(el: HTMLMediaElement, paused: boolean) {
  Object.defineProperty(el, "paused", { configurable: true, value: paused });
}

const advance = (ms: number) =>
  act(() => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
const setHidden = (next: boolean) =>
  act(() => {
    hidden = next;
    if (next) focused = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
const setFocused = (next: boolean, hasFocus = next) =>
  act(() => {
    focused = hasFocus;
    window.dispatchEvent(new Event(next ? "focus" : "blur"));
  });
const play = () =>
  act(() => {
    void video().play();
  });
const pause = () =>
  act(() => {
    video().pause();
  });

function render(props: Partial<MediaPlayerProps> = {}) {
  act(() =>
    root.render(
      <PlaybackProvider>
        <MediaPlayer
          name="clip"
          url="https://example.com/clip.mp4"
          playback="manual"
          save={(_key, value) => saves.push(value as VideoPlaybackRecord)}
          getElapsedTime={() => now / 1000}
          {...props}
        />
        <Probe />
      </PlaybackProvider>,
    ),
  );
}
const unmount = () => {
  act(() => root.unmount());
  mounted = false;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Accept-Ranges": "bytes" }),
    }),
  );
  vi.useFakeTimers();
  now = 0;
  hidden = false;
  focused = true;
  saves = [];
  handle = undefined;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  htmlPlay.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    setPaused(this, false);
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  htmlPause.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    if (this.paused) return;
    setPaused(this, true);
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(htmlPlay);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(htmlPause);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});
afterEach(() => {
  if (mounted) unmount();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("hidden pauses at once, logs the pause after a second, and resumes rewound in one save", () => {
  render({ pauseWhen: ["hidden"], rewindOnResume: 2 });
  video().currentTime = 10;
  play();
  expect(saves).toHaveLength(1);
  advance(5000);
  setHidden(true);
  expect(video().paused).toBe(true);
  expect(saves).toHaveLength(1);
  advance(999);
  expect(saves).toHaveLength(1);
  advance(1);
  expect(saves).toHaveLength(2);
  expect(tail(1)).toEqual([{ type: "pause", videoTime: 10, reason: "hidden" }]);
  // The pause keeps the time the participant left, not when it was written.
  expect(last().events.at(-1)?.stageTimeElapsed).toBe(5);
  advance(3000);
  setHidden(false);
  expect(saves).toHaveLength(3);
  expect(video().paused).toBe(false);
  expect(video().currentTime).toBe(8);
  expect(tail(2)).toEqual([
    { type: "seek", videoTime: 8, fromTime: 10, reason: "return" },
    { type: "play", videoTime: 8, reason: "return" },
  ]);
  expect(last()).toMatchObject({
    awayPauseCount: 1,
    awayPausedSeconds: 4,
    resumeBlockedCount: 0,
    awayPausesDropped: 0,
  });
});

test("a sub-second absence resumes with no save and no rewind", () => {
  render({ pauseWhen: ["hidden"], rewindOnResume: 2 });
  video().currentTime = 10;
  play();
  setHidden(true);
  advance(400);
  setHidden(false);
  expect(video().paused).toBe(false);
  expect(video().currentTime).toBe(10);
  expect(saves).toHaveLength(1);
  advance(2000);
  expect(saves).toHaveLength(1);
  pause();
  expect(last().events.map((e) => e.type)).toEqual(["play", "pause"]);
  expect(last().events.at(-1)?.reason).toBeUndefined();
  expect(last()).toMatchObject({ awayPauseCount: 1, awayPausedSeconds: 0.4 });
});

test("rewind on resume stops at startAt", () => {
  render({ pauseWhen: ["hidden"], rewindOnResume: 5, startAt: 9 });
  video().currentTime = 10;
  play();
  setHidden(true);
  advance(2000);
  setHidden(false);
  expect(video().currentTime).toBe(9);
  expect(tail(2)[0]).toEqual({
    type: "seek",
    videoTime: 9,
    fromTime: 10,
    reason: "return",
  });
});

test("a pause the participant chose stays paused", () => {
  render({ pauseWhen: ["hidden"] });
  play();
  pause();
  setHidden(true);
  advance(2000);
  setHidden(false);
  expect(htmlPlay).toHaveBeenCalledTimes(1);
  expect(video().paused).toBe(true);
  expect(saves).toHaveLength(2);
  expect(notice()).toBeNull();
});

test("hidden ignores a window that only loses focus", () => {
  render({ pauseWhen: ["hidden"] });
  play();
  setFocused(false);
  advance(2000);
  expect(video().paused).toBe(false);
  expect(saves).toHaveLength(1);
});

test("unfocused pauses on blur and resumes on focus", () => {
  render({ pauseWhen: ["unfocused"] });
  play();
  setFocused(false);
  expect(video().paused).toBe(true);
  advance(1500);
  expect(tail(1)).toEqual([
    { type: "pause", videoTime: 0, reason: "unfocused" },
  ]);
  setFocused(true);
  expect(video().paused).toBe(false);
  expect(tail(1)).toEqual([{ type: "play", videoTime: 0, reason: "return" }]);
});

test("unfocused treats focus moving into a frame on the page as still present", () => {
  // The window blurs, but the document still has focus: a click into an
  // iframe, such as a YouTube player with its own controls.
  render({ pauseWhen: ["unfocused"] });
  play();
  setFocused(false, true);
  advance(2000);
  expect(video().paused).toBe(false);
  expect(saves).toHaveLength(1);
});

test("unfocused also pauses for a hidden page, reported as hidden", () => {
  render({ pauseWhen: ["unfocused"] });
  play();
  setHidden(true);
  advance(1000);
  expect(tail(1)[0]).toMatchObject({ type: "pause", reason: "hidden" });
  // Visible again but another window still has focus: still away.
  act(() => {
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(video().paused).toBe(true);
  setFocused(true);
  expect(video().paused).toBe(false);
});

test("play-once resumes on its own, though the participant has no controls", async () => {
  render({ pauseWhen: ["hidden"], playback: "once", rewindOnResume: 1 });
  video().currentTime = 3;
  await act(async () => {
    video().dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();
  });
  expect(htmlPlay).toHaveBeenCalledTimes(1);
  expect(handle?.getTransportCapabilities?.()).toMatchObject({
    play: false,
    seek: false,
  });
  setHidden(true);
  advance(2000);
  setHidden(false);
  expect(video().paused).toBe(false);
  expect(video().currentTime).toBe(2);
  expect(tail(2)).toEqual([
    { type: "seek", videoTime: 2, fromTime: 3, reason: "return" },
    { type: "play", videoTime: 2, reason: "return" },
  ]);
});

test("a blocked resume shows a play control, counts the block, and keeps the rewind", async () => {
  render({ pauseWhen: ["hidden"], rewindOnResume: 2 });
  video().currentTime = 10;
  play();
  setHidden(true);
  advance(2000);
  htmlPlay.mockImplementationOnce(() =>
    Promise.reject(new DOMException("Not allowed", "NotAllowedError")),
  );
  await act(async () => {
    hidden = false;
    focused = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });
  expect(video().paused).toBe(true);
  expect(notice()).not.toBeNull();
  expect(notice()!.textContent).toMatch(/paused while you were away/i);
  // The rewind is logged even though playback did not start.
  expect(tail(1)).toEqual([
    { type: "seek", videoTime: 8, fromTime: 10, reason: "return" },
  ]);
  expect(last().resumeBlockedCount).toBe(1);
  const before = saves.length;
  advance(1000);
  act(() => notice()!.click());
  expect(video().paused).toBe(false);
  expect(notice()).toBeNull();
  expect(saves).toHaveLength(before + 1);
  // The participant pressed play: their own play, not an automatic one.
  expect(tail(1)).toEqual([{ type: "play", videoTime: 8 }]);
  expect(last()).toMatchObject({
    awayPauseCount: 1,
    awayPausedSeconds: 3,
    resumeBlockedCount: 1,
  });
});

test("resumeOnReturn: false leaves it paused, logs the pause on return, and offers play", () => {
  render({ pauseWhen: ["hidden"], resumeOnReturn: false, rewindOnResume: 2 });
  video().currentTime = 10;
  play();
  setHidden(true);
  advance(300);
  setHidden(false);
  expect(video().paused).toBe(true);
  expect(htmlPlay).toHaveBeenCalledTimes(1);
  expect(saves).toHaveLength(2);
  // Under a second away: the lasting pause is logged, with no rewind.
  expect(tail(1)).toEqual([{ type: "pause", videoTime: 10, reason: "hidden" }]);
  expect(notice()).not.toBeNull();
});

test("the playback handle sees the automatic pause, and its play is the participant's", () => {
  render({ pauseWhen: ["hidden"], resumeOnReturn: false });
  play();
  setHidden(true);
  expect(handle?.isPaused()).toBe(true);
  advance(1500);
  setHidden(false);
  expect(handle?.isPaused()).toBe(true);
  act(() => handle!.play());
  expect(handle?.isPaused()).toBe(false);
  expect(notice()).toBeNull();
  expect(tail(2)).toEqual([
    { type: "pause", videoTime: 0, reason: "hidden" },
    { type: "play", videoTime: 0 },
  ]);
});

test(`logs the first ${AWAY_LOG_CAP} away pauses, then only counts them`, () => {
  render({ pauseWhen: ["hidden"] });
  play();
  for (let i = 0; i < AWAY_LOG_CAP + 1; i++) {
    setHidden(true);
    advance(1000);
    setHidden(false);
  }
  expect(saves).toHaveLength(1 + 2 * AWAY_LOG_CAP);
  const reasons = last().events.filter((e) => e.reason !== undefined);
  expect(reasons).toHaveLength(2 * AWAY_LOG_CAP);
  pause();
  expect(last()).toMatchObject({
    awayPauseCount: AWAY_LOG_CAP + 1,
    awayPausesDropped: 1,
  });
});

test("leaving the page during a sub-second absence closes the range", () => {
  render({ pauseWhen: ["hidden"] });
  video().currentTime = 4;
  play();
  setHidden(true);
  advance(300);
  unmount();
  expect(tail(1)).toEqual([{ type: "removed", videoTime: 4 }]);
  expect(last().awayPauseCount).toBe(1);
  const count = saves.length;
  advance(5000);
  expect(saves).toHaveLength(count);
});

test("leaving the page after a logged away pause adds no save", () => {
  render({ pauseWhen: ["hidden"] });
  play();
  setHidden(true);
  advance(1000);
  const count = saves.length;
  unmount();
  expect(saves).toHaveLength(count);
});

test("playback that starts while away is paused at once", () => {
  hidden = true;
  focused = false;
  render({ pauseWhen: ["hidden"] });
  play();
  expect(video().paused).toBe(true);
  advance(1000);
  expect(tail(2)).toEqual([
    { type: "play", videoTime: 0 },
    { type: "pause", videoTime: 0, reason: "hidden" },
  ]);
  setHidden(false);
  expect(video().paused).toBe(false);
});

test("without pauseWhen, nothing pauses and the record has no away fields", () => {
  render();
  play();
  setHidden(true);
  setFocused(false);
  advance(2000);
  expect(video().paused).toBe(false);
  pause();
  expect(last()).not.toHaveProperty("awayPauseCount");
  expect(last()).not.toHaveProperty("awayPausedSeconds");
  expect(video().hasAttribute("disablepictureinpicture")).toBe(false);
});

test("pauseWhen turns off picture-in-picture", () => {
  render({ pauseWhen: ["hidden"] });
  expect(video().hasAttribute("disablepictureinpicture")).toBe(true);
});

test("an audio-only player pauses and offers the same resume control", () => {
  render({ pauseWhen: ["hidden"], resumeOnReturn: false, playVideo: false });
  play();
  setHidden(true);
  advance(1000);
  setHidden(false);
  expect(video().paused).toBe(true);
  expect(notice()).not.toBeNull();
  act(() => notice()!.click());
  expect(video().paused).toBe(false);
});
