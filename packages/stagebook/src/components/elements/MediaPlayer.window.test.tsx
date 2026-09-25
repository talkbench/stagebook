// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaPlayer, type MediaPlayerProps } from "./MediaPlayer.js";
import { PlaybackProvider, usePlayback } from "../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../playback/PlaybackHandle.js";

// The handle a MediaPlayer registers is what a sibling Timeline seeks
// through, so it — not only the Timeline's own clamps — must keep seeks in
// the player's window (#675). jsdom's <video> never loads, so the duration is
// set by hand where a test needs one.

let seen: (PlaybackHandle | null | undefined)[] = [];
function Probe() {
  seen.push(usePlayback("clip"));
  return null;
}

describe("MediaPlayer's registered handle follows its window (#675)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    seen = [];
  });

  function render(props: Partial<MediaPlayerProps>) {
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    act(() =>
      root!.render(
        <PlaybackProvider>
          <MediaPlayer
            name="clip"
            url="https://example.com/clip.mp4"
            save={() => {}}
            getElapsedTime={() => 0}
            {...props}
          />
          <Probe />
        </PlaybackProvider>,
      ),
    );
    const handle = seen.at(-1);
    if (!handle) throw new Error("no handle registered");
    const video = container!.querySelector("video")!;
    return { handle, video };
  }

  function setDuration(video: HTMLVideoElement, duration: number) {
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => duration,
    });
  }

  it("reports the window and clamps seeks to it", () => {
    const { handle, video } = render({ startAt: 4, stopAt: 6 });
    setDuration(video, 10);
    expect(handle.getBounds?.()).toEqual({ start: 4, end: 6 });
    handle.seekTo(0);
    expect(video.currentTime).toBe(4);
    handle.seekTo(9);
    expect(video.currentTime).toBe(6);
    handle.seekTo(5);
    expect(video.currentTime).toBe(5);
  });

  it("spans the whole file with allowScrubOutsideBounds", () => {
    const { handle, video } = render({
      startAt: 4,
      stopAt: 6,
      allowScrubOutsideBounds: true,
    });
    setDuration(video, 10);
    expect(handle.getBounds?.()).toEqual({ start: 0, end: 10 });
    handle.seekTo(9);
    expect(video.currentTime).toBe(9);
  });

  it("leaves the end open until the duration is known", () => {
    const { handle } = render({ startAt: 4 });
    expect(handle.getBounds?.()).toEqual({ start: 4, end: Infinity });
  });

  it("applies a changed window without re-registering the handle", () => {
    const first = render({ startAt: 4, stopAt: 6 }).handle;
    const { handle, video } = render({ startAt: 4, stopAt: 8 });
    setDuration(video, 10);
    expect(handle).toBe(first);
    expect(handle.getBounds?.()).toEqual({ start: 4, end: 8 });
    handle.seekTo(9);
    expect(video.currentTime).toBe(8);
  });
});
