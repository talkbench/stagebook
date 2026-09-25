// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaPlayer, type MediaPlayerProps } from "./MediaPlayer.js";
import { PlaybackProvider, usePlayback } from "../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../playback/PlaybackHandle.js";

// End-of-window behavior (#679, #684). jsdom's <video> never loads or plays,
// so each test drives currentTime, duration and paused by hand and stubs
// play()/pause() to flip `paused` and fire the events a browser would.

type Saved = {
  events: { type: string; videoTime: number; fromTime?: number }[];
};

let seen: (PlaybackHandle | null | undefined)[] = [];
function Probe() {
  seen.push(usePlayback("clip"));
  return null;
}

// React warns about updates outside act() unless the environment says so.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("MediaPlayer at the end of its window", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let saves: Saved[] = [];
  let completed = 0;
  const proto = window.HTMLMediaElement.prototype;
  const originals = {
    play: Object.getOwnPropertyDescriptor(proto, "play"),
    pause: Object.getOwnPropertyDescriptor(proto, "pause"),
  };

  beforeEach(() => {
    saves = [];
    completed = 0;
    seen = [];
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
        if (this.paused) return; // a real pause() on a paused video is silent
        Object.defineProperty(this, "paused", {
          configurable: true,
          get: () => true,
        });
        // Like a browser: timeupdate (already paused), then pause.
        this.dispatchEvent(new Event("timeupdate"));
        this.dispatchEvent(new Event("pause"));
      },
    });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    if (originals.play) Object.defineProperty(proto, "play", originals.play);
    if (originals.pause) Object.defineProperty(proto, "pause", originals.pause);
  });

  function render(props: Partial<MediaPlayerProps>) {
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
            onComplete={() => (completed += 1)}
            playback="manual"
            controls={{ playPause: true, seek: true }}
            {...props}
          />
          <Probe />
        </PlaybackProvider>,
      ),
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => 10,
    });
    // The player reads the duration when metadata loads.
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    const handle = seen.at(-1);
    if (!handle) throw new Error("no handle registered");
    return { video, handle };
  }

  /** Move the playhead the way a browser seek or playback tick would. */
  function moveTo(video: HTMLVideoElement, t: number) {
    act(() => {
      video.currentTime = t;
      video.dispatchEvent(new Event("timeupdate"));
    });
  }

  const events = () => saves.at(-1)?.events ?? [];
  const playButton = () =>
    container!.querySelector('[data-testid="mediaPlayer-playPause"]')!;

  describe("reaching stopAt (#679)", () => {
    it("pauses and records stopAt when playback reaches it", () => {
      const { video } = render({
        startAt: 4,
        stopAt: 6,
        submitOnComplete: true,
      });
      act(() => void video.play());
      moveTo(video, 6.1);
      expect(video.paused).toBe(true);
      expect(events().map((e) => e.type)).toEqual(["play", "stopAt"]);
      expect(completed).toBe(1);
    });

    it("counts a pause just past stopAt, before the next tick, as reaching it", () => {
      const { video } = render({
        startAt: 4,
        stopAt: 6,
        submitOnComplete: true,
      });
      act(() => void video.play());
      moveTo(video, 5.9);
      // Playback crosses stopAt between timeupdates and the participant
      // pauses first. pause() fires timeupdate (already paused), then pause.
      act(() => {
        video.currentTime = 6.1;
        video.pause();
      });
      expect(events().map((e) => e.type)).toEqual(["play", "stopAt"]);
      expect(completed).toBe(1);
    });

    it("doesn't count a seek to stopAt while paused as reaching it", () => {
      const { video } = render({
        startAt: 4,
        stopAt: 6,
        submitOnComplete: true,
      });
      moveTo(video, 6);
      expect(events().map((e) => e.type)).not.toContain("stopAt");
      expect(completed).toBe(0);
      // And the next real pause is still recorded, not swallowed.
      moveTo(video, 5);
      act(() => void video.play());
      act(() => video.pause());
      expect(events().map((e) => e.type)).toEqual(["play", "pause"]);
    });
  });

  describe("replay (#684)", () => {
    it("the play button replays from startAt once playback reached stopAt", () => {
      const { video } = render({ startAt: 4, stopAt: 6 });
      act(() => void video.play());
      moveTo(video, 6.1);
      expect(playButton().getAttribute("aria-label")).toBe("Replay");

      act(() => (playButton() as HTMLButtonElement).click());
      expect(video.currentTime).toBe(4);
      expect(video.paused).toBe(false);
      expect(events().map((e) => e.type)).toEqual([
        "play",
        "stopAt",
        "seek",
        "play",
      ]);
      expect(events()[2]).toMatchObject({ videoTime: 4, fromTime: 6.1 });
      // The replayed play starts at startAt, which watched ranges key on.
      expect(events()[3]).toMatchObject({ type: "play", videoTime: 4 });
    });

    it("Space on the player replays too", () => {
      const { video } = render({ startAt: 4, stopAt: 6 });
      moveTo(video, 6);
      act(() => {
        container!
          .querySelector('[data-testid="mediaPlayer"]')!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: " ", bubbles: true }),
          );
      });
      expect(video.currentTime).toBe(4);
      expect(video.paused).toBe(false);
    });

    it("the registered handle's play() replays, so a Timeline's Space does", () => {
      const { video, handle } = render({ startAt: 4, stopAt: 6 });
      moveTo(video, 6);
      act(() => handle.play());
      expect(video.currentTime).toBe(4);
      expect(video.paused).toBe(false);
    });

    it("plays the last moments after a small step back from the natural end", () => {
      const { video } = render({ startAt: 4 });
      act(() => {
        video.currentTime = 10;
        video.dispatchEvent(new Event("ended"));
      });
      expect(playButton().getAttribute("aria-label")).toBe("Replay");
      moveTo(video, 9.7);
      expect(playButton().getAttribute("aria-label")).toBe("Play");
      act(() => (playButton() as HTMLButtonElement).click());
      expect(video.currentTime).toBe(9.7);
      expect(events().map((e) => e.type)).not.toContain("seek");
    });

    it("doesn't replay a stage-synced clip", () => {
      const { video, handle } = render({
        startAt: 4,
        stopAt: 6,
        syncToStageTime: true,
        controls: undefined,
      });
      moveTo(video, 6);
      act(() => handle.play());
      expect(video.currentTime).toBe(6);
      expect(events().map((e) => e.type)).not.toContain("seek");
    });

    it("replays from startAt at the natural end of the file", () => {
      const { video } = render({ startAt: 4 });
      moveTo(video, 10);
      expect(playButton().getAttribute("aria-label")).toBe("Replay");
      act(() => (playButton() as HTMLButtonElement).click());
      expect(video.currentTime).toBe(4);
    });

    it("replays to startAt even when scrubbing outside the window is allowed", () => {
      const { video } = render({
        startAt: 4,
        stopAt: 6,
        allowScrubOutsideBounds: true,
      });
      moveTo(video, 8);
      act(() => (playButton() as HTMLButtonElement).click());
      expect(video.currentTime).toBe(4);
    });

    it("plays from where it is anywhere before the end", () => {
      const { video } = render({ startAt: 4, stopAt: 6 });
      moveTo(video, 5);
      expect(playButton().getAttribute("aria-label")).toBe("Play");
      act(() => (playButton() as HTMLButtonElement).click());
      expect(video.currentTime).toBe(5);
      expect(events().map((e) => e.type)).toEqual(["play"]);
    });

    it("doesn't replay a play-once clip", () => {
      const { video, handle } = render({
        startAt: 4,
        stopAt: 6,
        playback: "once",
        controls: undefined,
      });
      moveTo(video, 6);
      act(() => handle.play());
      expect(video.currentTime).toBe(6);
    });
  });
});
