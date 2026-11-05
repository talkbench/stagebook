// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MediaPlayer, type MediaPlayerProps } from "./MediaPlayer.js";
import type { VideoPlaybackRecord } from "../../schemas/mediaPlayerRecord.js";

interface StubPlayer {
  time: number;
  state: number;
  muted: boolean;
  volume: number;
  change: (state: number) => void;
}

let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
let now: number;
let hidden: boolean;
let focused: boolean;
let players: StubPlayer[];
const save = vi.fn<(key: string, record: unknown) => void>();
const getElapsedTime = vi.fn(() => now / 1000);
const player = () => players.at(-1)!;
const record = () => save.mock.calls.at(-1)![1] as VideoPlaybackRecord;
const advance = (ms: number) =>
  act(() => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
const change = (state: number) => act(() => player().change(state));
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
async function render(props: Partial<MediaPlayerProps> = {}) {
  await act(async () => {
    root.render(
      <MediaPlayer
        name="clip"
        url="https://youtu.be/QC8iQqtG0hg"
        playback="manual"
        autoplay={false}
        save={save}
        getElapsedTime={getElapsedTime}
        {...props}
      />,
    );
    await Promise.resolve();
  });
}
function unmount() {
  act(() => root.unmount());
  mounted = false;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  now = 0;
  hidden = false;
  focused = true;
  players = [];
  save.mockClear();
  getElapsedTime.mockClear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  (window as unknown as { YT?: unknown }).YT = {
    Player: function (
      _element: unknown,
      options: {
        events: {
          onReady: () => void;
          onStateChange: (event: { data: number }) => void;
        };
      },
    ) {
      const stub: StubPlayer = {
        time: 0,
        state: 2,
        muted: false,
        volume: 65,
        change: () => {},
      };
      stub.change = (state) => {
        stub.state = state;
        options.events.onStateChange({ data: state });
      };
      players.push(stub);
      queueMicrotask(() => options.events.onReady());
      return {
        playVideo: () => stub.change(1),
        pauseVideo: () => stub.change(2),
        seekTo: (time: number) => {
          stub.time = time;
        },
        getCurrentTime: () => stub.time,
        getDuration: () => 100,
        getPlayerState: () => stub.state,
        isMuted: () => stub.muted,
        getVolume: () => stub.volume,
        destroy: () => {},
      };
    },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) unmount();
  container.remove();
  delete (window as unknown as { YT?: unknown }).YT;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("YouTube play samples actual backend audio and existing polls coalesce changes without saving", async () => {
  await render();
  expect(save).not.toHaveBeenCalled();
  expect(getElapsedTime).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1); // Existing250ms playhead poll only.
  change(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(record().firstPlay).toMatchObject({
    type: "play",
    muted: false,
    volume: 0.65,
  });
  const earlier = JSON.stringify(record());
  advance(1000);
  expect(getElapsedTime).toHaveBeenCalledTimes(1); // Unchangedaudio polls read no stage clock.
  player().muted = true;
  player().volume = 40;
  player().time = 1.25;
  advance(250);
  player().volume = 0;
  player().time = 1.5;
  advance(250);
  advance(500);
  expect(save).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  change(2);
  expect(save).toHaveBeenCalledTimes(2);
  expect(record().events.map((event) => event.type)).toEqual([
    "play",
    "volumechange",
    "pause",
  ]);
  expect(record().events[1]).toMatchObject({
    muted: true,
    volume: 0,
    videoTime: 1.5,
    stageTimeElapsed: 1.5,
  });
  expect(JSON.stringify(save.mock.calls[0][1])).toBe(earlier);
  advance(1000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("YouTube hidden and unfocused time excludes buffering without adding transport events or saves", async () => {
  await render();
  visibility(true);
  focus(false);
  change(1);
  advance(2000);
  change(3); // Buffering is not a pause in the legacy eventlog.
  advance(5000);
  visibility(false); // Transitions while buffering do not contribute to playbackcounts.
  change(1);
  advance(1000);
  visibility(true);
  advance(2000);
  focus(true);
  change(2);
  expect(save).toHaveBeenCalledTimes(2);
  expect(record().events.map((event) => event.type)).toEqual(["play", "pause"]);
  expect(record()).toMatchObject({
    hiddenPlaybackSeconds: 4,
    unfocusedPlaybackSeconds: 5,
    visibilityChangesDuringPlayback: 1,
  });
  advance(10000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("paused YouTube audio changes remain unsaved and unmount leaves no poll or settle timer", async () => {
  await render();
  player().muted = true;
  advance(250);
  expect(vi.getTimerCount()).toBe(2);
  unmount();
  expect(save).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  advance(1000);
  expect(save).not.toHaveBeenCalled();
});

test("same-source backend replacement retains totals and places prior observations before its restoration boundary", async () => {
  await render({ sourceId: "same-recording" });
  visibility(true);
  change(1);
  advance(1000);
  player().volume = 20;
  advance(250);
  const old = player();
  await render({
    sourceId: "same-recording",
    url: "https://youtu.be/abcdefghijk",
  });
  expect(player()).not.toBe(old);
  advance(5000);
  expect(save).toHaveBeenCalledTimes(1);
  change(1);
  advance(1000);
  change(2);
  expect(record().hiddenPlaybackSeconds).toBeCloseTo(2.25);
  expect(record().events.map((event) => event.type)).toEqual([
    "play",
    "volumechange",
    "restored",
    "play",
    "pause",
  ]);
});

test.each(["matching", "different-source", "malformed"] as const)(
  "%s restored telemetry seeds only validated observations",
  async (kind) => {
    const initialRecord: VideoPlaybackRecord = {
      name: "clip",
      url: "https://youtu.be/QC8iQqtG0hg",
      sourceId:
        kind === "different-source" ? "other-recording" : "same-recording",
      events: [
        { type: "play", videoTime: 0, stageTimeElapsed: 0 },
        { type: "pause", videoTime: 5, stageTimeElapsed: 5 },
      ],
      lastVideoTime: 5,
      watchedRanges: [[0, 5]],
      hiddenPlaybackSeconds: kind === "malformed" ? -1 : 4,
      unfocusedPlaybackSeconds: 2,
      visibilityChangesDuringPlayback: 3,
    };
    const earlier = JSON.stringify(initialRecord);
    hidden = true;
    focused = false;
    await render({ sourceId: "same-recording", initialRecord });
    advance(10000);
    expect(save).not.toHaveBeenCalled();
    change(1);
    advance(2000);
    change(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(record()).toMatchObject({
      hiddenPlaybackSeconds: kind === "matching" ? 6 : 2,
      unfocusedPlaybackSeconds: kind === "matching" ? 4 : 2,
      visibilityChangesDuringPlayback: kind === "matching" ? 3 : 0,
    });
    expect(
      record().events.filter((event) => event.type === "restored"),
    ).toHaveLength(kind === "matching" ? 1 : 0);
    expect(JSON.stringify(initialRecord)).toBe(earlier);
  },
);
