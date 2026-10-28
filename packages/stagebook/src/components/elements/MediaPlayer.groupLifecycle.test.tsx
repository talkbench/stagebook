// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MediaPlayer } from "./MediaPlayer.js";
import type { VideoPlaybackRecord } from "../../schemas/mediaPlayerRecord.js";

// The browser tests exercise the real graph. Here, isolate the lifetime of
// the media element and its event history when a host rotates signed URLs.
vi.mock("./mediaPlayer/playbackGraph.js", () => ({
  buildPlaybackGraph: () => ({
    analysers: [{ frequencyBinCount: 1, getByteTimeDomainData() {} }],
    gains: [{ gain: { value: 1 } }],
  }),
}));
vi.mock("./mediaPlayer/channelCountMonitor.js", () => ({
  monitorChannelCount: () => Promise.resolve(() => {}),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

it("preserves group playback history and its audio source on signed URL rotation", () => {
  const createSource = vi.fn(() => ({}));
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      createMediaElementSource = createSource;
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("offline"))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const saves: VideoPlaybackRecord[] = [];
  const mapping = [{ index: 0, role: "participant", position: 5 }];
  const render = (url: string) =>
    act(() =>
      root.render(
        <MediaPlayer
          name="group"
          url={url}
          sourceId="room.mp4"
          channelMapping={mapping}
          save={(_key, value) => saves.push(value as VideoPlaybackRecord)}
          getElapsedTime={() => 0}
          playback="manual"
        />,
      ),
    );
  try {
    render("https://example.com/room.mp4?token=first");
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { get: () => 100 });
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
      video.dispatchEvent(new Event("play"));
      video.currentTime = 10;
      video.dispatchEvent(new Event("pause"));
    });
    expect(saves.at(-1)?.watchedRanges).toEqual([[0, 10]]);

    render("https://example.com/room.mp4?token=second");
    const refreshedVideo = container.querySelector("video")!;
    act(() => {
      refreshedVideo.currentTime = 20;
      refreshedVideo.dispatchEvent(new Event("play"));
      refreshedVideo.currentTime = 25;
      refreshedVideo.dispatchEvent(new Event("pause"));
    });
    expect(saves.at(-1)?.watchedRanges).toEqual([
      [0, 10],
      [20, 25],
    ]);
    expect(saves.at(-1)?.events.map((event) => event.type)).toEqual([
      "play",
      "pause",
      "restored",
      "play",
      "pause",
    ]);
    expect(refreshedVideo).toBe(video);
    expect(createSource).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
