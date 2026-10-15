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

// Autoplay chooses who initiates playback; once still controls transport.
describe("independent initial start (#798)", () => {
  for (const backend of ["HTML5", "YouTube"] as const) {
    const url =
      backend === "HTML5"
        ? "https://example.com/clip.mp4"
        : "https://youtu.be/QC8iQqtG0hg";
    function ready() {
      if (backend === "HTML5") return metadata();
      act(() => players.at(-1)!.events.onReady?.());
      return null;
    }
    function plays() {
      return backend === "HTML5" ? htmlPlay : players.at(-1)!.player.playVideo;
    }
    function started(video: HTMLVideoElement | null) {
      act(() => {
        if (video) video.dispatchEvent(new Event("play"));
        else players.at(-1)!.events.onStateChange?.({ data: 1 });
      });
    }

    it.each([true, false])(
      `${backend} once without autoplay exposes one ready start (video=%s)`,
      async (playVideo) => {
        let resolve!: () => void;
        htmlPlay.mockReturnValue(
          new Promise<void>((r) => {
            resolve = r;
          }),
        );
        render({ url, playback: "once", autoplay: false, playVideo });
        const beforeReady = currentHandle!;
        expect(beforeReady.getTransportCapabilities?.()).toEqual({
          play: false,
          pause: false,
          seek: false,
        });
        expect(fallback()).toBeNull();
        const video = ready();
        expect(plays()).not.toHaveBeenCalled();
        expect(fallback()).not.toBeNull();
        expect(currentHandle).not.toBe(beforeReady);
        const retained = currentHandle!;
        expect(retained.getTransportCapabilities?.()).toEqual({
          play: true,
          pause: false,
          seek: false,
        });
        act(() => {
          retained.play();
          retained.play();
          retained.pause();
          retained.seekTo(5);
        });
        expect(plays()).toHaveBeenCalledOnce();
        expect(retained.getTransportCapabilities?.().play).toBe(false);
        expect(currentHandle).not.toBe(retained);
        expect(fallback()).toBeNull();
        if (video) expect(video.currentTime).toBe(4);
        else expect(players.at(-1)!.player.seekTo).not.toHaveBeenCalled();
        started(video);
        if (video)
          await act(async () => {
            resolve();
            await Promise.resolve();
          });
        act(() => {
          if (video) video.dispatchEvent(new Event("ended"));
          else players.at(-1)!.events.onStateChange?.({ data: 0 });
        });
        render({ url, playback: "once", autoplay: true, playVideo });
        render({ url, playback: "once", autoplay: false, playVideo });
        act(() => retained.play());
        expect(plays()).toHaveBeenCalledOnce();
        expect(fallback()).toBeNull();
        expect(currentHandle!.getTransportCapabilities?.().play).toBe(false);
      },
    );

    it(`${backend} rejected user start restores live capabilities and the button`, async () => {
      htmlPlay.mockRejectedValueOnce(new Error("blocked"));
      render({ url, playback: "once", autoplay: false });
      ready();
      const retained = currentHandle!;
      act(() => {
        retained.play();
        retained.play();
      });
      expect(plays()).toHaveBeenCalledOnce();
      expect(retained.getTransportCapabilities?.().play).toBe(false);
      if (backend === "HTML5") await flush();
      else act(() => players.at(-1)!.events.onAutoplayBlocked?.());
      expect(retained.getTransportCapabilities?.().play).toBe(true);
      expect(fallback()).not.toBeNull();
      act(() => fallback()!.click());
      await flush();
      expect(plays()).toHaveBeenCalledTimes(2);
    });

    it(`${backend} explicit manual autoplay starts once and preserves fallback and transport`, async () => {
      htmlPlay.mockRejectedValueOnce(new Error("blocked"));
      render({
        url,
        playback: "manual",
        autoplay: true,
        controls: { playPause: true },
      });
      const video = ready();
      expect(plays()).toHaveBeenCalledOnce();
      if (backend === "HTML5") await flush();
      else act(() => players.at(-1)!.events.onAutoplayBlocked?.());
      expect(fallback()).not.toBeNull();
      expect(currentHandle!.getTransportCapabilities?.()).toEqual({
        play: true,
        pause: true,
        seek: true,
      });
      act(() => fallback()!.click());
      started(video);
      await flush();
      expect(plays()).toHaveBeenCalledTimes(2);
      act(() => currentHandle!.play());
      await flush();
      expect(plays()).toHaveBeenCalledTimes(3);
      expect(fallback()).toBeNull();
    });
  }

  it("a native play event before buffering completes does not consume a rejected start", async () => {
    let reject!: (reason: Error) => void;
    htmlPlay.mockReturnValueOnce(
      new Promise((_resolve, r) => {
        reject = r;
      }),
    );
    render({ playback: "once", autoplay: false });
    const video = metadata();
    act(() => {
      currentHandle!.play();
      video.dispatchEvent(new Event("play"));
      video.dispatchEvent(new Event("waiting"));
    });
    expect(currentHandle!.getTransportCapabilities?.().play).toBe(false);
    await act(async () => {
      reject(new Error("play interrupted while buffering"));
      await Promise.resolve();
    });
    expect(currentHandle!.getTransportCapabilities?.().play).toBe(true);
    expect(fallback()).not.toBeNull();
  });

  it.each([true, false])(
    "successful native manual playback consumes later once start (video=%s)",
    (playVideo) => {
      render({ playback: "manual", playVideo });
      const video = metadata();
      act(() => {
        video.dispatchEvent(new Event("playing"));
      });
      render({ playback: "once", autoplay: false, playVideo });
      expect(currentHandle!.getTransportCapabilities?.().play).toBe(false);
      expect(fallback()).toBeNull();
    },
  );

  it("native stage-time positioning precedes explicit autoplay", async () => {
    const positions: number[] = [];
    htmlPlay.mockImplementation(() => {
      positions.push(container.querySelector("video")!.currentTime);
      return Promise.resolve();
    });
    render({ syncToStageTime: true, autoplay: true, getElapsedTime: () => 3 });
    metadata();
    await flush();
    expect(positions).toEqual([7]);
  });

  it("a new native source waits for its own readiness and ignores the old user-start rejection", async () => {
    let reject!: (reason: Error) => void;
    htmlPlay.mockReturnValueOnce(
      new Promise((_resolve, r) => {
        reject = r;
      }),
    );
    render({ playback: "once", autoplay: false });
    metadata();
    act(() => currentHandle!.play());
    expect(htmlPlay).toHaveBeenCalledOnce();
    render({
      url: "https://example.com/next.mp4",
      playback: "once",
      autoplay: false,
    });
    await act(async () => {
      reject(new Error("old blocked"));
      await Promise.resolve();
    });
    expect(currentHandle!.getTransportCapabilities?.().play).toBe(false);
    expect(fallback()).toBeNull();
    metadata();
    expect(currentHandle!.getTransportCapabilities?.().play).toBe(true);
    expect(fallback()).not.toBeNull();
    expect(htmlPlay).toHaveBeenCalledOnce();
  });
});
