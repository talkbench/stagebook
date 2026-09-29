// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaPlayer, type MediaPlayerProps } from "./MediaPlayer.js";
import { PlaybackProvider, usePlayback } from "../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../playback/PlaybackHandle.js";

// The event log a sibling Timeline writes through (#682) and the close at
// unmount (#677), with fake timers so a seek stream's settle window is
// exact. jsdom's <video> never plays: play()/pause() are stubbed to flip
// `paused` and fire their events, and time is moved by hand. YouTube runs
// against a stub window.YT, which YouTubePlayer picks up synchronously.

type Saved = {
  events: {
    type: string;
    videoTime: number;
    fromTime?: number;
    playbackRate?: number;
  }[];
  lastVideoTime: number;
  watchedRanges: [number, number][];
};

let seen: (PlaybackHandle | null | undefined)[] = [];
function Probe() {
  seen.push(usePlayback("clip"));
  return null;
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let saves: Saved[] = [];

function mount(props: Partial<MediaPlayerProps> & { url?: string }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <PlaybackProvider>
        <MediaPlayer
          name="clip"
          url="https://example.com/clip.mp4"
          save={(_key, value) => saves.push(value as Saved)}
          getElapsedTime={() => 0}
          playback="manual"
          controls={{ playPause: true, seek: true, speed: true }}
          {...props}
        />
        <Probe />
      </PlaybackProvider>,
    ),
  );
}

function unmount() {
  act(() => root!.unmount());
  root = null;
}

function handle(): PlaybackHandle {
  const h = seen.at(-1);
  if (!h) throw new Error("no handle registered");
  return h;
}

const record = () => saves.at(-1);
const types = () => record()?.events.map((e) => e.type) ?? [];

function settle(ms = 500) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  saves = [];
  seen = [];
});

afterEach(() => {
  if (root) unmount();
  container?.remove();
  container = null;
  vi.useRealTimers();
});

describe("HTML5", () => {
  const proto = window.HTMLMediaElement.prototype;
  const originals = {
    play: Object.getOwnPropertyDescriptor(proto, "play"),
    pause: Object.getOwnPropertyDescriptor(proto, "pause"),
  };

  beforeEach(() => {
    Object.defineProperty(proto, "play", {
      configurable: true,
      value(this: HTMLMediaElement) {
        Object.defineProperty(this, "paused", {
          configurable: true,
          get: () => false,
        });
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      },
    });
    Object.defineProperty(proto, "pause", {
      configurable: true,
      value(this: HTMLMediaElement) {
        if (this.paused) return;
        Object.defineProperty(this, "paused", {
          configurable: true,
          get: () => true,
        });
        this.dispatchEvent(new Event("pause"));
      },
    });
  });

  afterEach(() => {
    if (originals.play) Object.defineProperty(proto, "play", originals.play);
    if (originals.pause) Object.defineProperty(proto, "pause", originals.pause);
  });

  function setup(props: Partial<MediaPlayerProps> = {}) {
    mount(props);
    const video = container!.querySelector("video")!;
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => 100,
    });
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    return video;
  }

  /** Playback (or anything unlogged) moving the playhead. */
  function moveTo(video: HTMLVideoElement, t: number) {
    act(() => {
      video.currentTime = t;
      video.dispatchEvent(new Event("timeupdate"));
    });
  }

  it("logs a stream of sibling seeks once it settles", () => {
    setup();
    act(() => {
      handle().seekTo(10);
      handle().seekTo(20);
      handle().seekTo(30);
    });
    settle(499);
    expect(saves).toHaveLength(0);
    settle(1);
    expect(saves).toHaveLength(1);
    expect(record()?.events).toEqual([
      expect.objectContaining({ type: "seek", fromTime: 0, videoTime: 30 }),
    ]);
  });

  it("logs the time a seek was clamped to by the player's window", () => {
    setup({ startAt: 4, stopAt: 6 });
    act(() => {
      handle().seekTo(90);
    });
    settle();
    expect(record()?.events).toEqual([
      expect.objectContaining({ type: "seek", videoTime: 6 }),
    ]);
  });

  it("logs a pending seek before the play that follows it", () => {
    const video = setup();
    moveTo(video, 5.5);
    act(() => {
      handle().seekTo(4.2);
      handle().play();
    });
    moveTo(video, 5);
    act(() => handle().pause());
    expect(record()?.events).toEqual([
      expect.objectContaining({ type: "seek", fromTime: 5.5, videoTime: 4.2 }),
      expect.objectContaining({ type: "play", videoTime: 4.2 }),
      expect.objectContaining({ type: "pause", videoTime: 5 }),
    ]);
    expect(record()?.watchedRanges).toEqual([[4.2, 5]]);
  });

  it("logs a pending seek before playback reaches stopAt", () => {
    const video = setup({ stopAt: 60 });
    moveTo(video, 10);
    act(() => handle().play());
    moveTo(video, 20);
    act(() => {
      handle().seekTo(58);
    });
    moveTo(video, 60.1);
    expect(types()).toEqual(["play", "seek", "stopAt"]);
    expect(record()?.watchedRanges).toEqual([
      [10, 20],
      [58, 60.1],
    ]);
  });

  it("closes playback at unmount after a seek made during it", () => {
    const video = setup();
    moveTo(video, 10);
    act(() => handle().play());
    moveTo(video, 20);
    act(() => {
      handle().seekTo(50);
    });
    moveTo(video, 55);
    unmount(); // inside the seek's settle window
    expect(record()?.events).toEqual([
      expect.objectContaining({ type: "play", videoTime: 10 }),
      expect.objectContaining({ type: "seek", fromTime: 20, videoTime: 50 }),
      expect.objectContaining({ type: "removed", videoTime: 55 }),
    ]);
    expect(record()?.lastVideoTime).toBe(55);
    expect(record()?.watchedRanges).toEqual([
      [10, 20],
      [50, 55],
    ]);
  });

  it("closes playback at unmount after a speed change during it", () => {
    const video = setup();
    moveTo(video, 10);
    act(() => handle().play());
    const player = container!.querySelector('[data-testid="mediaPlayer"]')!;
    act(() => {
      player.dispatchEvent(
        new KeyboardEvent("keydown", { key: ">", bubbles: true }),
      );
    });
    moveTo(video, 14);
    unmount();
    expect(types()).toEqual(["play", "speed", "removed"]);
    expect(record()?.watchedRanges).toEqual([[10, 14]]);
  });

  it("logs nothing through a handle a sibling still holds after unmount", () => {
    setup();
    const stale = handle();
    unmount();
    const before = saves.length;
    stale.seekTo(30);
    settle(1000);
    expect(saves).toHaveLength(before);
  });
});

describe("YouTube", () => {
  // The stub player follows seeks and, when `reports` is on, reports a
  // state change after each one the way the IFrame API does: PAUSED again
  // after a paused seek, BUFFERING then PLAYING after a seek during playback.
  type Stub = {
    time: number;
    state: number;
    reports: boolean;
    change: (state: number) => void;
  };
  let stub: Stub;

  beforeEach(() => {
    stub = { time: 0, state: 2, reports: false, change: () => {} };
    const w = window as unknown as { YT?: unknown };
    w.YT = {
      Player: function (
        _el: unknown,
        opts: {
          events: {
            onReady: () => void;
            onStateChange: (e: { data: number }) => void;
          };
        },
      ) {
        stub.change = (state) => {
          stub.state = state;
          opts.events.onStateChange({ data: state });
        };
        queueMicrotask(() => opts.events.onReady());
        return {
          playVideo: () => stub.change(1),
          pauseVideo: () => stub.change(2),
          seekTo: (t: number) => {
            stub.time = t;
            if (!stub.reports) return;
            if (stub.state === 1) {
              stub.change(3);
              stub.change(1);
            } else {
              stub.change(2);
            }
          },
          getCurrentTime: () => stub.time,
          getDuration: () => 100,
          getPlayerState: () => stub.state,
          destroy: () => {},
        };
      },
    };
  });

  afterEach(() => {
    delete (window as unknown as { YT?: unknown }).YT;
  });

  async function setup() {
    mount({ url: "https://youtu.be/QC8iQqtG0hg" });
    await act(async () => {
      await Promise.resolve();
    });
    // Ready: the registered handle is now the YouTube one.
    expect(handle().isYouTube).toBe(true);
  }

  it("logs one seek for a stream made while paused, despite PAUSED reports", async () => {
    await setup();
    stub.reports = true;
    act(() => {
      handle().seekTo(10);
      handle().seekTo(20);
      handle().seekTo(30);
    });
    settle();
    expect(record()?.events).toEqual([
      expect.objectContaining({ type: "seek", fromTime: 0, videoTime: 30 }),
    ]);
  });

  it("logs one seek for a stream made during playback, despite PLAYING reports", async () => {
    await setup();
    stub.time = 10;
    act(() => handle().play());
    stub.time = 12;
    stub.reports = true;
    act(() => {
      handle().seekTo(40);
      handle().seekTo(50);
    });
    settle();
    expect(types()).toEqual(["play", "seek"]);
    expect(record()?.events[1]).toMatchObject({ fromTime: 12, videoTime: 50 });
  });

  it("closes playback at unmount at the player's live position", async () => {
    await setup();
    stub.time = 12;
    act(() => handle().play());
    // Between the player's 250ms polls.
    stub.time = 27.3;
    unmount();
    expect(record()?.events.at(-1)).toMatchObject({
      type: "removed",
      videoTime: 27.3,
    });
    expect(record()?.watchedRanges).toEqual([[12, 27.3]]);
  });
});
