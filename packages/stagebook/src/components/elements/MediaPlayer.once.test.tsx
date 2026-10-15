// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaPlayer, type MediaPlayerProps } from "./MediaPlayer.js";
import { PlaybackProvider, usePlayback } from "../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../playback/PlaybackHandle.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let currentHandle: PlaybackHandle | undefined;
function Probe() {
  currentHandle = usePlayback("clip");
  return null;
}

type YouTubeEvents = {
  onReady?: () => void;
  onStateChange?: (event: { data: number }) => void;
  onAutoplayBlocked?: () => void;
};
function youtubePlayer() {
  return {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: vi.fn(() => 4),
    getDuration: () => 10,
    getPlayerState: vi.fn(() => 2),
    destroy: vi.fn(),
  };
}
let players: {
  player: ReturnType<typeof youtubePlayer>;
  events: YouTubeEvents;
}[];
let container: HTMLDivElement;
let root: Root;
const save = vi.fn();
const htmlPlay = vi.fn<() => Promise<void>>();
const htmlPause = vi.fn<() => void>();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  save.mockClear();
  currentHandle = undefined;
  players = [];
  Object.assign(window, {
    YT: {
      Player: function (
        _element: HTMLElement,
        opts: { events: YouTubeEvents },
      ) {
        const player = youtubePlayer();
        players.push({ player, events: opts.events });
        return player;
      },
    },
  });
  htmlPlay.mockReset().mockResolvedValue();
  htmlPause.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(htmlPlay);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(htmlPause);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.YT;
  vi.restoreAllMocks();
});
function render(props: Partial<MediaPlayerProps> = {}) {
  act(() =>
    root.render(
      <PlaybackProvider>
        <MediaPlayer
          name="clip"
          url="https://example.com/clip.mp4"
          save={save}
          getElapsedTime={() => 0}
          startAt={4}
          stopAt={6}
          {...props}
        />
        <Probe />
      </PlaybackProvider>,
    ),
  );
}
function metadata() {
  const video = container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 10 });
  Object.defineProperty(video, "seekable", {
    configurable: true,
    value: { length: 1, end: () => 10 },
  });
  act(() => {
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  return video;
}
const fallback = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="mediaPlayer-playOnce"]',
  );
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
function attemptTransport() {
  act(() => {
    currentHandle!.play();
    currentHandle!.pause();
    currentHandle!.seekTo(5);
  });
}

describe("play-once participant transport (#779)", () => {
  it.each([undefined, "once"] as const)(
    "HTML5 denies shared transport for playback=%s before and after completion",
    async (playback) => {
      render({ playback });
      const video = container.querySelector("video")!;
      expect(currentHandle!.getTransportCapabilities?.()).toEqual({
        play: false,
        pause: false,
        seek: false,
      });
      attemptTransport();
      expect(video.currentTime).toBe(4);
      expect(htmlPlay).not.toHaveBeenCalled();
      expect(htmlPause).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      metadata();
      await flush();
      expect(htmlPlay).toHaveBeenCalledTimes(1);
      act(() => {
        video.currentTime = 6;
        video.dispatchEvent(new Event("ended"));
      });
      const savedCount = save.mock.calls.length;
      attemptTransport();
      expect(video.currentTime).toBe(6);
      expect(htmlPlay).toHaveBeenCalledTimes(1);
      expect(htmlPause).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(savedCount);
    },
  );

  it("manual still exposes play, pause and bounded seeks", () => {
    render({ playback: "manual" });
    const video = container.querySelector("video")!;
    expect(currentHandle!.getTransportCapabilities?.()).toEqual({
      play: true,
      pause: true,
      seek: true,
    });
    attemptTransport();
    expect(htmlPlay).toHaveBeenCalledOnce();
    expect(htmlPause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(5);
  });

  it("applies playback-mode changes to a retained shared handle", () => {
    render({ playback: "manual" });
    const retained = currentHandle!;
    render({ playback: "once" });
    act(() => retained.seekTo(5));
    expect(container.querySelector("video")!.currentTime).toBe(4);
    expect(retained.getTransportCapabilities?.().seek).toBe(false);
  });

  it("starts an already loaded HTML5 source when manual changes to once", async () => {
    render({ playback: "manual" });
    metadata();
    expect(htmlPlay).not.toHaveBeenCalled();
    render({ playback: "once" });
    await flush();
    expect(htmlPlay).toHaveBeenCalledOnce();
  });

  it("HTML5 fallback retries a rejected start, then stays consumed", async () => {
    const play = htmlPlay;
    play.mockRejectedValueOnce(new Error("autoplay blocked"));
    render();
    const video = metadata();
    await flush();
    expect(fallback()).not.toBeNull();
    act(() => fallback()!.click());
    await flush();
    expect(play).toHaveBeenCalledTimes(2);
    expect(fallback()).toBeNull();
    act(() => {
      video.dispatchEvent(new Event("ended"));
    });
    attemptTransport();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("HTML5 ignores a stale rejection after the source changes", async () => {
    let reject!: (error: Error) => void;
    htmlPlay.mockReturnValueOnce(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    render();
    metadata();
    render({ url: "https://example.com/next.mp4" });
    metadata();
    await act(async () => {
      reject(new Error("old source blocked"));
      await Promise.resolve();
    });
    expect(fallback()).toBeNull();
  });

  it("HTML5 restarts once for each source even when durations match", async () => {
    render();
    metadata();
    await flush();
    render({ url: "https://example.com/next.mp4" });
    metadata();
    await flush();
    expect(htmlPlay).toHaveBeenCalledTimes(2);
  });

  it("YouTube allows its initial autoplay/fallback but denies shared transport throughout", () => {
    render({ url: "https://youtu.be/QC8iQqtG0hg" });
    const { player, events } = players[0];
    act(() => events.onReady?.());
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    expect(currentHandle!.getTransportCapabilities?.()).toEqual({
      play: false,
      pause: false,
      seek: false,
    });
    attemptTransport();
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(player.seekTo).not.toHaveBeenCalled();
    act(() => events.onAutoplayBlocked?.());
    expect(fallback()).not.toBeNull();
    act(() => fallback()!.click());
    expect(player.playVideo).toHaveBeenCalledTimes(2);
    act(() => events.onStateChange?.({ data: 1 }));
    act(() => events.onAutoplayBlocked?.());
    expect(fallback()).toBeNull();
    act(() => events.onStateChange?.({ data: 0 }));
    attemptTransport();
    expect(player.playVideo).toHaveBeenCalledTimes(2);
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it("YouTube resets for a new source and ignores the destroyed player's callbacks", () => {
    render({ url: "https://youtu.be/QC8iQqtG0hg" });
    const first = players[0];
    act(() => first.events.onReady?.());
    act(() => first.events.onStateChange?.({ data: 1 }));
    render({ url: "https://youtu.be/dQw4w9WgXcQ" });
    act(() => first.events.onAutoplayBlocked?.());
    expect(fallback()).toBeNull();
    const second = players[1];
    act(() => second.events.onReady?.());
    expect(second.player.playVideo).toHaveBeenCalledOnce();
    act(() => second.events.onAutoplayBlocked?.());
    expect(fallback()).not.toBeNull();
  });

  it("YouTube retries an unstarted replacement when startAt changes", () => {
    render({ url: "https://youtu.be/QC8iQqtG0hg" });
    const first = players[0];
    act(() => first.events.onReady?.());
    expect(first.player.playVideo).toHaveBeenCalledOnce();
    render({ url: "https://youtu.be/QC8iQqtG0hg", startAt: 5 });
    expect(first.player.playVideo).toHaveBeenCalledOnce();
    const second = players[1];
    act(() => second.events.onReady?.());
    expect(second.player.playVideo).toHaveBeenCalledOnce();
    act(() => second.events.onAutoplayBlocked?.());
    expect(fallback()).not.toBeNull();
  });

  it("switching to manual hides a blocked fallback and ignores a pending rejection", async () => {
    let reject!: (error: Error) => void;
    htmlPlay.mockReturnValueOnce(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    render();
    metadata();
    render({ playback: "manual" });
    await act(async () => {
      reject(new Error("autoplay blocked"));
      await Promise.resolve();
    });
    expect(fallback()).toBeNull();
    render({ playback: "once" });
    expect(fallback()).not.toBeNull();
    render({ playback: "manual" });
    expect(fallback()).toBeNull();
  });

  it("starts a ready YouTube source when manual controls change to once without recreating it", () => {
    const url = "https://youtu.be/QC8iQqtG0hg";
    render({ url, playback: "manual", controls: { playPause: true } });
    const { player, events } = players[0];
    act(() => events.onReady?.());
    expect(player.playVideo).not.toHaveBeenCalled();
    render({ url, playback: "once" });
    expect(players).toHaveLength(1);
    expect(player.playVideo).toHaveBeenCalledOnce();
    act(() => events.onAutoplayBlocked?.());
    expect(fallback()).not.toBeNull();
  });

  it("settles a blocked YouTube start during a same-player manual interval", () => {
    const url = "https://youtu.be/QC8iQqtG0hg";
    render({ url, playback: "once" });
    const { player, events } = players[0];
    act(() => events.onReady?.());
    expect(player.playVideo).toHaveBeenCalledOnce();
    render({ url, playback: "manual", controls: { playPause: true } });
    expect(players).toHaveLength(1);
    act(() => events.onAutoplayBlocked?.());
    expect(fallback()).toBeNull();
    render({ url, playback: "once" });
    expect(players).toHaveLength(1);
    expect(fallback()).not.toBeNull();
    expect(player.playVideo).toHaveBeenCalledOnce();
    act(() => fallback()!.click());
    expect(player.playVideo).toHaveBeenCalledTimes(2);
  });

  it("YouTube manual does not autoplay and retains shared transport", () => {
    render({ url: "https://youtu.be/QC8iQqtG0hg", playback: "manual" });
    const { player, events } = players[0];
    act(() => events.onReady?.());
    expect(player.playVideo).not.toHaveBeenCalled();
    attemptTransport();
    expect(player.playVideo).toHaveBeenCalledOnce();
    expect(player.pauseVideo).toHaveBeenCalledOnce();
    expect(player.seekTo).toHaveBeenCalledWith(5, true);
  });
});
