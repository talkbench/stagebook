// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MediaPlayer,
  type MediaPlayerProps,
  type VideoPlaybackRecord,
} from "./MediaPlayer.js";
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

let container: HTMLDivElement;
let root: Root | null;
let saves: VideoPlaybackRecord[];
const onComplete = vi.fn();
const htmlPlay = vi.fn<(this: HTMLMediaElement) => Promise<void>>();
const htmlPause = vi.fn<(this: HTMLMediaElement) => void>();

function setPaused(video: HTMLMediaElement, paused: boolean) {
  Object.defineProperty(video, "paused", { configurable: true, value: paused });
}

function startPlaying(video: HTMLMediaElement) {
  setPaused(video, false);
  video.dispatchEvent(new Event("play"));
}

// Real promises let Vitest detect an unhandled rejection. Do not add a catch
// here: observing each native play() promise is the player's responsibility.
function pendingPlay({ emitPlay = true } = {}) {
  let reject!: (error: DOMException) => void;
  const promise = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  htmlPlay.mockImplementationOnce(function (this: HTMLMediaElement) {
    if (emitPlay) startPlaying(this);
    return promise;
  });
  return async (name = "AbortError") => {
    const error = new DOMException("The play request failed", name);
    await act(async () => {
      reject(error);
      await Promise.resolve();
    });
    return error;
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  saves = [];
  currentHandle = undefined;
  onComplete.mockClear();
  htmlPlay.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    startPlaying(this);
    return Promise.resolve();
  });
  htmlPause.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    if (this.paused) return;
    setPaused(this, true);
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(htmlPlay);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(htmlPause);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(props: Partial<MediaPlayerProps> = {}) {
  act(() =>
    root!.render(
      <PlaybackProvider>
        <MediaPlayer
          name="clip"
          url="https://example.com/clip.mp4"
          playback="manual"
          autoplay={false}
          controls={{ playPause: true, seek: true }}
          save={(_key, value) => saves.push(value as VideoPlaybackRecord)}
          getElapsedTime={() => 0}
          submitOnComplete
          onComplete={onComplete}
          {...props}
        />
        <Probe />
      </PlaybackProvider>,
    ),
  );
}

function setup(props: Partial<MediaPlayerProps> = {}) {
  render(props);
  const video = container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 100 });
  Object.defineProperty(video, "seekable", {
    configurable: true,
    value: { length: 1, end: () => 100 },
  });
  act(() => {
    video.dispatchEvent(new Event("loadedmetadata"));
    container
      .querySelector('[data-testid="mediaPlayer"]')!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  return video;
}

function button() {
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="mediaPlayer-playPause"]',
  )!;
}

function clickPlayPause() {
  act(() => button().click());
}

function moveTo(video: HTMLVideoElement, time: number) {
  act(() => {
    video.currentTime = time;
    video.dispatchEvent(new Event("timeupdate"));
  });
}

function scrubTo(time: number) {
  const bar = container.querySelector<HTMLElement>(
    '[data-testid="mediaPlayer-scrubBar"]',
  )!;
  vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: 100,
  } as DOMRect);
  act(() => {
    bar.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: time }),
    );
    bar.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, clientX: time }),
    );
  });
}

describe("native play promise interruptions (#800)", () => {
  it("keeps a rapid Play → Pause paused and records only the actual playback", async () => {
    const reject = pendingPlay();
    const video = setup();
    clickPlayPause();
    expect(button().getAttribute("aria-label")).toBe("Pause");
    clickPlayPause();
    const savedBeforeRejection = [...saves];

    await reject();

    expect(video.paused).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("Play");
    expect(htmlPlay).toHaveBeenCalledOnce();
    expect(htmlPause).toHaveBeenCalledOnce();
    expect(saves).toEqual(savedBeforeRejection);
    expect(saves.at(-1)?.events.map((event) => event.type)).toEqual([
      "play",
      "pause",
    ]);
    expect(saves.at(-1)?.watchedRanges).toEqual([]);
    expect(saves.at(-1)?.firstEnd).toBeUndefined();
    expect(onComplete).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("observes scrub-resume rejection after Pause without adding watched time", async () => {
    const video = setup();
    clickPlayPause();
    moveTo(video, 10);
    const reject = pendingPlay();
    scrubTo(40);
    expect(video.currentTime).toBe(40);
    clickPlayPause();
    const savedBeforeRejection = [...saves];

    await reject();

    expect(video.paused).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("Play");
    expect(htmlPlay).toHaveBeenCalledTimes(2);
    expect(htmlPause).toHaveBeenCalledTimes(2);
    expect(saves).toEqual(savedBeforeRejection);
    expect(saves.at(-1)?.watchedRanges).toEqual([[0, 10]]);
    expect(saves.at(-1)?.events.map((event) => event.type)).toEqual([
      "play",
      "pause",
      "seek",
      "play",
      "pause",
    ]);
    expect(saves.at(-1)?.firstEnd).toBeUndefined();
    expect(onComplete).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("remains resumable after a browser pause while the document is hidden", async () => {
    const reject = pendingPlay();
    const video = setup();
    clickPlayPause();
    moveTo(video, 8);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      video.pause();
    });

    await reject();

    expect(button().getAttribute("aria-label")).toBe("Play");
    expect(currentHandle!.getTransportCapabilities?.()).toEqual({
      play: true,
      pause: true,
      seek: true,
    });
    expect(htmlPlay).toHaveBeenCalledOnce();
    expect(saves.at(-1)?.watchedRanges).toEqual([[0, 8]]);
    expect(onComplete).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();

    clickPlayPause();
    expect(htmlPlay).toHaveBeenCalledTimes(2);
    expect(video.paused).toBe(false);
    expect(button().getAttribute("aria-label")).toBe("Pause");
  });

  it("synchronizes the paused control when interruption precedes the native pause event", async () => {
    const reject = pendingPlay();
    const video = setup();
    clickPlayPause();
    // The paused property can change before the browser's queued pause event.
    setPaused(video, true);

    await reject();

    expect(button().getAttribute("aria-label")).toBe("Play");
    expect(htmlPlay).toHaveBeenCalledOnce();
    expect(htmlPause).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    act(() => {
      video.dispatchEvent(new Event("pause"));
    });
    expect(saves.at(-1)?.watchedRanges).toEqual([]);
  });

  it("ignores a pending request's rejection after unmount", async () => {
    const reject = pendingPlay();
    const video = setup();
    clickPlayPause();
    moveTo(video, 5);
    act(() => root!.unmount());
    root = null;
    const savedBeforeRejection = [...saves];

    await reject("NotAllowedError");

    expect(htmlPlay).toHaveBeenCalledOnce();
    expect(htmlPause).not.toHaveBeenCalled();
    expect(saves).toEqual(savedBeforeRejection);
    expect(saves.at(-1)?.watchedRanges).toEqual([[0, 5]]);
    expect(onComplete).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("ignores an old source's rejection before the replacement starts", async () => {
    const reject = pendingPlay();
    setup();
    clickPlayPause();
    render({ url: "https://example.com/next.mp4" });
    const video = container.querySelector("video")!;
    // A source load resets the native paused state without a new play request.
    act(() => {
      setPaused(video, true);
      video.dispatchEvent(new Event("pause"));
    });
    const savedBeforeRejection = [...saves];

    await reject("NotSupportedError");

    expect(video.paused).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("Play");
    expect(htmlPlay).toHaveBeenCalledOnce();
    expect(htmlPause).not.toHaveBeenCalled();
    expect(saves).toEqual(savedBeforeRejection);
    expect(onComplete).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();

    clickPlayPause();
    expect(htmlPlay).toHaveBeenCalledTimes(2);
    expect(button().getAttribute("aria-label")).toBe("Pause");
  });

  it("does not let an older request's rejection disturb a later play", async () => {
    const reject = pendingPlay();
    const video = setup();
    clickPlayPause();
    clickPlayPause();
    clickPlayPause();
    const savedBeforeRejection = [...saves];

    await reject("NotAllowedError");

    expect(video.paused).toBe(false);
    expect(button().getAttribute("aria-label")).toBe("Pause");
    expect(htmlPlay).toHaveBeenCalledTimes(2);
    expect(htmlPause).toHaveBeenCalledOnce();
    expect(saves).toEqual(savedBeforeRejection);
    expect(onComplete).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["NotAllowedError", "NotSupportedError"])(
    "reports a genuine %s and permits a normal control retry",
    async (name) => {
      const reject = pendingPlay({ emitPlay: false });
      const video = setup();
      clickPlayPause();

      const error = await reject(name);

      expect(console.error).toHaveBeenCalledWith(expect.any(String), error);
      expect(video.paused).toBe(true);
      expect(button().getAttribute("aria-label")).toBe("Play");
      expect(htmlPlay).toHaveBeenCalledOnce();
      expect(htmlPause).not.toHaveBeenCalled();
      expect(saves).toHaveLength(0);
      expect(onComplete).not.toHaveBeenCalled();

      clickPlayPause();
      expect(htmlPlay).toHaveBeenCalledTimes(2);
      expect(video.paused).toBe(false);
      expect(button().getAttribute("aria-label")).toBe("Pause");
    },
  );
});
