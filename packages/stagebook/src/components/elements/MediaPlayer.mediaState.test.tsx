// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  MediaPlayer,
  type MediaPlayerProps,
  type VideoPlaybackRecord,
} from "./MediaPlayer.js";

let root: Root;
let container: HTMLDivElement;
let now: number;
let hidden: boolean;
let focused: boolean;
let fullscreen: Element | null;
let mounted: boolean;
const save = vi.fn<(key: string, value: unknown) => void>();
const record = () => save.mock.calls.at(-1)![1] as VideoPlaybackRecord;
const video = () => container.querySelector("video")!;
const fire = (type: string) =>
  act(() => {
    video().dispatchEvent(new Event(type));
  });
const advance = (ms: number) =>
  act(() => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
const visibility = (next: boolean) =>
  act(() => {
    hidden = next;
    document.dispatchEvent(new Event("visibilitychange"));
  });
const focus = (next: boolean) =>
  act(() => {
    focused = next;
    window.dispatchEvent(new Event(next ? "focus" : "blur"));
  });
const render = (props: Partial<MediaPlayerProps> = {}) =>
  act(() =>
    root.render(
      <MediaPlayer
        name="clip"
        url="https://example.com/clip.mp4"
        playback="manual"
        save={save}
        getElapsedTime={() => now / 1000}
        {...props}
      />,
    ),
  );
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
  fullscreen = null;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
  save.mockClear();
});
afterEach(() => {
  if (mounted) unmount();
  container.remove();
  delete (document as unknown as { fullscreenElement?: Element })
    .fullscreenElement;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("play snapshots actual audio settings and a volume drag rides the next pause save", () => {
  render({ playAudio: false });
  video().volume = 0.4;
  fire("play");
  expect(record().events.find((event) => event.type === "play")).toMatchObject({
    type: "play",
    muted: true,
    volume: 0.4,
  });
  expect(record().firstPlay).toMatchObject({ muted: true, volume: 0.4 });
  const first = JSON.stringify(record());
  const initialEventCount = record().events.length;
  for (const value of [0.3, 0.2, 0]) {
    act(() => {
      video().volume = value;
      video().dispatchEvent(new Event("volumechange"));
    });
    advance(100);
  }
  advance(500);
  expect(save).toHaveBeenCalledTimes(1);
  fire("pause");
  expect(save).toHaveBeenCalledTimes(2);
  expect(
    record()
      .events.slice(initialEventCount)
      .filter((event) => event.type === "volumechange"),
  ).toEqual([expect.objectContaining({ muted: true, volume: 0 })]);
  expect(record().events.at(-1)?.type).toBe("pause");
  expect(JSON.stringify(save.mock.calls[0][1])).toBe(first);
  advance(1000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("hidden/focus wall time excludes waiting and paused time without extra saves", () => {
  render();
  fire("play");
  advance(1000); // play is only a request, not confirmed rendering
  fire("playing");
  visibility(true);
  advance(2000);
  focus(false);
  advance(1000);
  visibility(false);
  advance(1000);
  fire("waiting");
  advance(5000);
  visibility(true); // a transition during buffering does not count
  fire("playing");
  advance(2000);
  focus(true);
  advance(1000);
  expect(save).toHaveBeenCalledTimes(1);
  fire("pause");
  expect(save).toHaveBeenCalledTimes(2);
  expect(record()).toMatchObject({
    hiddenPlaybackSeconds: 6,
    unfocusedPlaybackSeconds: 4,
    visibilityChangesDuringPlayback: 2,
  });
  advance(10000);
  visibility(false);
  fire("play");
  expect(record()).toMatchObject({
    hiddenPlaybackSeconds: 6,
    unfocusedPlaybackSeconds: 4,
    visibilityChangesDuringPlayback: 2,
  });
});

test("pending audio and presentation events flush on existing removal, not on observation", () => {
  render();
  fire("play");
  fire("playing");
  act(() => {
    fullscreen = video();
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  act(() => {
    fullscreen = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  fire("enterpictureinpicture");
  fire("leavepictureinpicture");
  act(() => {
    video().muted = true;
    video().dispatchEvent(new Event("volumechange"));
  });
  visibility(true);
  advance(200);
  expect(save).toHaveBeenCalledTimes(1);
  unmount();
  expect(save).toHaveBeenCalledTimes(2);
  expect(record().hiddenPlaybackSeconds).toBeCloseTo(0.2);
  expect(record().events.map((event) => event.type)).toEqual([
    "play",
    "fullscreenchange",
    "fullscreenchange",
    "enterpictureinpicture",
    "leavepictureinpicture",
    "volumechange",
    "removed",
  ]);
  expect(
    record()
      .events.filter((event) => event.type === "fullscreenchange")
      .map((event) => event.fullscreen),
  ).toEqual([true, false]);
  expect(vi.getTimerCount()).toBe(0);
  advance(1000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("a paused player does not save its final telemetry tail or another player's fullscreen", () => {
  render();
  act(() => {
    fullscreen = document.body;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  video().volume = 0.3;
  fire("volumechange");
  advance(1000);
  expect(save).not.toHaveBeenCalled();
  unmount();
  expect(save).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("restoration keeps observed totals without counting the disconnected interval", () => {
  render();
  fire("play");
  fire("playing");
  visibility(true);
  advance(2000);
  fire("pause");
  const initialRecord = record();
  unmount();
  advance(10000);
  root = createRoot(container);
  mounted = true;
  render({ initialRecord });
  expect(save).toHaveBeenCalledTimes(2);
  advance(10000);
  fire("play");
  fire("playing");
  advance(1000);
  fire("pause");
  expect(record().hiddenPlaybackSeconds).toBe(3);
  expect(
    record().events.filter((event) => event.type === "restored"),
  ).toHaveLength(1);
});

test("new sources reset counters and drop pending telemetry from the previous source", () => {
  render();
  fire("play");
  fire("playing");
  visibility(true);
  advance(1000);
  video().volume = 0.2;
  fire("volumechange");
  render({ url: "https://example.com/other.mp4" });
  advance(10000);
  fire("play");
  fire("playing");
  advance(2000);
  fire("pause");
  expect(record().hiddenPlaybackSeconds).toBe(2);
  expect(record().events.map((event) => event.type)).toEqual(["play", "pause"]);
});

test("buffered seek completion resumes a prior active interval even after waiting", () => {
  render();
  Object.defineProperty(video(), "paused", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(video(), "readyState", {
    configurable: true,
    value: 4,
  });
  fire("play");
  fire("playing");
  visibility(true);
  advance(1000);
  fire("seeking");
  fire("waiting");
  advance(10000);
  fire("seeked");
  advance(2000);
  fire("pause");
  expect(record().hiddenPlaybackSeconds).toBe(3);
  expect(save).toHaveBeenCalledTimes(2);
});

test.each(["initial", "paused"])(
  "%s seek completion never invents an active interval",
  (kind) => {
    render();
    Object.defineProperty(video(), "readyState", {
      configurable: true,
      value: 4,
    });
    if (kind === "paused") {
      Object.defineProperty(video(), "paused", {
        configurable: true,
        value: false,
      });
      fire("play");
      fire("playing");
      fire("seeking");
      Object.defineProperty(video(), "paused", {
        configurable: true,
        value: true,
      });
      fire("pause");
    } else {
      Object.defineProperty(video(), "paused", {
        configurable: true,
        value: false,
      });
      fire("play");
      fire("seeking");
    }
    visibility(true);
    fire("seeked");
    advance(5000);
    fire("pause");
    expect(record().hiddenPlaybackSeconds).toBe(0);
  },
);
