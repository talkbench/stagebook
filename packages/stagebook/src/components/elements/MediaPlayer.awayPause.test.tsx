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
import {
  AWAY_LOG_CAP,
  AWAY_RESUME_WATCHDOG_MS,
  AWAY_RETURN_GRACE_MS,
} from "./mediaPlayer/awayPause.js";

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
// The player reads focus a task after `blur`; run that task.
const setFocused = (next: boolean, hasFocus = next) =>
  act(() => {
    focused = hasFocus;
    window.dispatchEvent(new Event(next ? "focus" : "blur"));
    if (!next) vi.advanceTimersByTime(0);
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
  // A return by focus waits for the click that may have brought it.
  expect(video().paused).toBe(true);
  advance(AWAY_RETURN_GRACE_MS);
  expect(video().paused).toBe(false);
  expect(tail(1)).toEqual([{ type: "play", videoTime: 0, reason: "return" }]);
});

test("unfocused: the click on play that brings the window back is the participant's play", () => {
  render({ pauseWhen: ["unfocused"], controls: { playPause: true } });
  play();
  setFocused(false);
  advance(1500);
  // Focus arrives before the click lands.
  setFocused(true);
  act(() => {
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="mediaPlayer-playPause"]',
      )!
      .click();
  });
  expect(video().paused).toBe(false);
  advance(AWAY_RETURN_GRACE_MS);
  expect(video().paused).toBe(false);
  expect(tail(2)).toEqual([
    { type: "pause", videoTime: 0, reason: "unfocused" },
    { type: "play", videoTime: 0 },
  ]);
});

test("unfocused: a short absence is judged at the return, not after the wait", () => {
  render({ pauseWhen: ["unfocused"], rewindOnResume: 2 });
  video().currentTime = 10;
  play();
  setFocused(false);
  advance(700);
  setFocused(true);
  advance(AWAY_RETURN_GRACE_MS);
  expect(video().paused).toBe(false);
  expect(video().currentTime).toBe(10);
  expect(saves).toHaveLength(1);
});

test("unfocused: leaving again during the wait keeps it paused and still logs", () => {
  render({ pauseWhen: ["unfocused"] });
  play();
  setFocused(false);
  advance(300);
  setFocused(true);
  advance(200);
  setFocused(false);
  advance(AWAY_RETURN_GRACE_MS);
  expect(video().paused).toBe(true);
  advance(1000);
  expect(tail(1)).toEqual([
    { type: "pause", videoTime: 0, reason: "unfocused" },
  ]);
});

test("a tab switch that loses focus before hiding is logged as hidden", () => {
  render({ pauseWhen: ["unfocused"] });
  play();
  setFocused(false);
  act(() => {
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  advance(1000);
  expect(tail(1)[0]).toMatchObject({ type: "pause", reason: "hidden" });
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
  advance(AWAY_RETURN_GRACE_MS);
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

const refuseNextPlay = (name = "NotAllowedError") =>
  htmlPlay.mockImplementationOnce(() =>
    Promise.reject(new DOMException("Refused", name)),
  );
const returnAsync = async () =>
  act(async () => {
    hidden = false;
    focused = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });

test("a refused resume after a sub-second absence logs the pause that now lasts", async () => {
  render({ pauseWhen: ["hidden"] });
  play();
  setHidden(true);
  advance(300);
  refuseNextPlay();
  await returnAsync();
  expect(notice()).not.toBeNull();
  expect(tail(1)).toEqual([{ type: "pause", videoTime: 0, reason: "hidden" }]);
  advance(60_000);
  act(() => notice()!.click());
  expect(last().events.map((e) => [e.type, e.reason])).toEqual([
    ["play", undefined],
    ["pause", "hidden"],
    ["play", undefined],
  ]);
});

test("an aborted resume offers the control without counting a refusal", async () => {
  render({ pauseWhen: ["hidden"] });
  play();
  setHidden(true);
  advance(2000);
  refuseNextPlay("AbortError");
  await returnAsync();
  expect(notice()).not.toBeNull();
  expect(last().resumeBlockedCount).toBe(0);
});

test("a resume that never starts gets the control after the watchdog", () => {
  render({ pauseWhen: ["hidden"] });
  play();
  setHidden(true);
  advance(2000);
  // Neither a play event nor a settled promise.
  htmlPlay.mockImplementationOnce(() => new Promise<void>(() => {}));
  setHidden(false);
  expect(notice()).toBeNull();
  advance(AWAY_RESUME_WATCHDOG_MS);
  expect(notice()).not.toBeNull();
  // The count rides on the next save: here, the participant's play.
  act(() => notice()!.click());
  expect(tail(1)).toEqual([{ type: "play", videoTime: 0 }]);
  expect(last().resumeBlockedCount).toBe(1);
});

test("one return reported twice resumes and rewinds once, while play is pending", () => {
  render({ pauseWhen: ["hidden"], rewindOnResume: 2 });
  video().currentTime = 10;
  play();
  setHidden(true);
  advance(2000);
  // A real play event follows play() as a later task.
  htmlPlay.mockImplementationOnce(function (this: HTMLMediaElement) {
    setTimeout(() => {
      setPaused(this, false);
      this.dispatchEvent(new Event("play"));
    }, 10);
    return Promise.resolve();
  });
  act(() => {
    hidden = false;
    focused = true;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  advance(AWAY_RETURN_GRACE_MS);
  expect(htmlPlay).toHaveBeenCalledTimes(2);
  expect(video().currentTime).toBe(8);
  expect(last().events.filter((e) => e.type === "seek")).toHaveLength(1);
});

test("resumeOnReturn: false offers the control once for a return reported twice", () => {
  render({ pauseWhen: ["hidden"], resumeOnReturn: false, rewindOnResume: 2 });
  video().currentTime = 10;
  play();
  setHidden(true);
  advance(2000);
  act(() => {
    hidden = false;
    focused = true;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  advance(AWAY_RETURN_GRACE_MS);
  // The rewind of a lasting pause is logged at the return.
  expect(tail(2)).toEqual([
    { type: "pause", videoTime: 10, reason: "hidden" },
    { type: "seek", videoTime: 8, fromTime: 10, reason: "return" },
  ]);
  expect(video().currentTime).toBe(8);
  expect(htmlPlay).toHaveBeenCalledTimes(1);
});

test("play-once: a resume control whose play is refused again stays offered", async () => {
  render({ pauseWhen: ["hidden"], playback: "once" });
  await act(async () => {
    video().dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();
  });
  setHidden(true);
  advance(2000);
  refuseNextPlay();
  await returnAsync();
  refuseNextPlay();
  await act(async () => {
    notice()!.click();
    await Promise.resolve();
  });
  expect(notice()).not.toBeNull();
  act(() => notice()!.click());
  expect(video().paused).toBe(false);
  expect(notice()).toBeNull();
});

test("a restored record continues the counters and the log cap", () => {
  const at = { videoTime: 0, stageTimeElapsed: 0 };
  const events = [
    { ...at, type: "play" as const },
    ...Array.from({ length: AWAY_LOG_CAP }, () => [
      { ...at, type: "pause" as const, reason: "hidden" as const },
      { ...at, type: "play" as const, reason: "return" as const },
    ]).flat(),
    { ...at, type: "pause" as const },
  ];
  render({
    pauseWhen: ["hidden"],
    rewindOnResume: 2,
    initialRecord: {
      name: "clip",
      url: "https://example.com/clip.mp4",
      events,
      lastVideoTime: 0,
      watchedRanges: [],
      awayPauseCount: 60,
      awayPausedSeconds: 30,
      resumeBlockedCount: 0,
      awayPausesDropped: 10,
    },
  });
  video().currentTime = 10;
  play();
  setHidden(true);
  advance(2000);
  setHidden(false);
  // Past the cap: resumed without a logged pause, and without a rewind.
  expect(video().currentTime).toBe(10);
  pause();
  expect(last().events.filter((e) => e.reason === "hidden")).toHaveLength(
    AWAY_LOG_CAP,
  );
  expect(last()).toMatchObject({
    awayPauseCount: 61,
    awayPausedSeconds: 32,
    awayPausesDropped: 11,
  });
});

test("a clip past stopAt when the page hides is over, not resumed", () => {
  render({ pauseWhen: ["hidden"], stopAt: 5 });
  play();
  video().currentTime = 5.05;
  setHidden(true);
  advance(2000);
  setHidden(false);
  expect(htmlPlay).toHaveBeenCalledTimes(1);
  expect(last().events.map((e) => e.type)).toEqual(["play", "stopAt"]);
});

test("a new source drops the resume control and the open absence", () => {
  render({ pauseWhen: ["hidden"], resumeOnReturn: false });
  play();
  setHidden(true);
  advance(1000);
  setHidden(false);
  expect(notice()).not.toBeNull();
  render({
    pauseWhen: ["hidden"],
    resumeOnReturn: false,
    url: "https://example.com/other.mp4",
  });
  expect(notice()).toBeNull();
});

test("with syncToStageTime the setting is off at runtime too", () => {
  render({ pauseWhen: ["hidden"], syncToStageTime: true });
  play();
  setHidden(true);
  advance(2000);
  expect(video().paused).toBe(false);
  pause();
  expect(last()).not.toHaveProperty("awayPauseCount");
});

test("a sibling's play while still away is the participant's, and pauses again", () => {
  render({ pauseWhen: ["hidden"] });
  play();
  setHidden(true);
  advance(300);
  act(() => handle!.play());
  expect(video().paused).toBe(true);
  advance(1000);
  expect(last().events.map((e) => [e.type, e.reason])).toEqual([
    ["play", undefined],
    ["pause", "hidden"],
    ["play", undefined],
    ["pause", "hidden"],
  ]);
});
