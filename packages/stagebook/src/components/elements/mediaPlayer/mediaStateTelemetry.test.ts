import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMediaStateTelemetry } from "./mediaStateTelemetry.js";
import type { VideoEvent } from "../../../schemas/mediaPlayerRecord.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("coalesces a dragged volume slider to its last state and timestamp", () => {
  const telemetry = createMediaStateTelemetry();
  telemetry.seedAudio({ muted: false, volume: 1 });
  telemetry.observeAudio({ muted: false, volume: 0.8 }, () => ({
    videoTime: 4,
    stageTimeElapsed: 10,
  }));
  vi.advanceTimersByTime(400);
  telemetry.observeAudio({ muted: false, volume: 0.4 }, () => ({
    videoTime: 4.4,
    stageTimeElapsed: 10.4,
  }));
  vi.advanceTimersByTime(400);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(100);
  expect(vi.getTimerCount()).toBe(0);
  expect(telemetry.drain()).toEqual([
    {
      type: "volumechange",
      muted: false,
      volume: 0.4,
      videoTime: 4.4,
      stageTimeElapsed: 10.4,
    },
  ]);
  expect(telemetry.drain()).toEqual([]);
});

it("does not restart a settle timer for unchanged sampled state", () => {
  const telemetry = createMediaStateTelemetry();
  telemetry.seedAudio({ muted: false, volume: 1 });
  telemetry.observeAudio({ muted: true, volume: 1 }, () => ({
    videoTime: 1,
    stageTimeElapsed: 1,
  }));
  vi.advanceTimersByTime(400);
  telemetry.observeAudio({ muted: true, volume: 1 }, () => ({
    videoTime: 1.4,
    stageTimeElapsed: 1.4,
  }));
  vi.advanceTimersByTime(100);
  expect(vi.getTimerCount()).toBe(0);
  expect(telemetry.drain()).toEqual([
    {
      type: "volumechange",
      muted: true,
      volume: 1,
      videoTime: 1,
      stageTimeElapsed: 1,
    },
  ]);
});

it("reads event clocks only when an audio state actually changes", () => {
  const telemetry = createMediaStateTelemetry();
  telemetry.seedAudio({ muted: false, volume: 1 });
  const timing = vi.fn(() => ({ videoTime: 1, stageTimeElapsed: 2 }));
  telemetry.observeAudio({ muted: false, volume: 1 }, timing);
  expect(timing).not.toHaveBeenCalled();
  telemetry.observeAudio({ muted: false, volume: 0.5 }, timing);
  expect(timing).toHaveBeenCalledTimes(1);
  telemetry.observeAudio({ muted: false, volume: 0.5 }, timing);
  expect(timing).toHaveBeenCalledTimes(1);
});

it("baseline snapshots do not invent an initial volume event", () => {
  const telemetry = createMediaStateTelemetry();
  telemetry.seedAudio({ muted: null, volume: null });
  telemetry.seedAudio({ muted: false, volume: 0.5 });
  telemetry.observeAudio({ muted: false, volume: 0.5 }, () => ({
    videoTime: 0,
    stageTimeElapsed: 2,
  }));
  expect(telemetry.drain()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("native volume observation can be recorded before an explicit baseline", () => {
  const telemetry = createMediaStateTelemetry();
  telemetry.observeAudio({ muted: false, volume: 0 }, () => ({
    videoTime: 0,
    stageTimeElapsed: 1,
  }));
  expect(telemetry.drain()).toEqual([
    {
      type: "volumechange",
      muted: false,
      volume: 0,
      videoTime: 0,
      stageTimeElapsed: 1,
    },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it("copies channel state at observation and treats channel changes as volume state", () => {
  const telemetry = createMediaStateTelemetry();
  const channels = [false, false];
  telemetry.seedAudio({ muted: false, volume: 1, channelMuted: channels });
  channels[0] = true;
  telemetry.observeAudio(
    { muted: false, volume: 1, channelMuted: channels },
    () => ({ videoTime: 2, stageTimeElapsed: 3 }),
  );
  channels[1] = true;
  expect(telemetry.drain()).toEqual([
    {
      type: "volumechange",
      muted: false,
      volume: 1,
      channelMuted: [true, false],
      videoTime: 2,
      stageTimeElapsed: 3,
    },
  ]);
});

it("flushes pending volume before a presentation event without a duplicate timer tail", () => {
  const telemetry = createMediaStateTelemetry();
  telemetry.observeAudio({ muted: true, volume: 1 }, () => ({
    videoTime: 2,
    stageTimeElapsed: 2,
  }));
  telemetry.queue({
    type: "fullscreenchange",
    fullscreen: true,
    videoTime: 3,
    stageTimeElapsed: 3,
  });
  expect(telemetry.drain().map((event) => event.type)).toEqual([
    "volumechange",
    "fullscreenchange",
  ]);
  vi.advanceTimersByTime(1000);
  expect(telemetry.drain()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("caps each new event kind across saved and restored history without capping transport", () => {
  const initial: VideoEvent[] = Array.from({ length: 49 }, (_, index) => ({
    type: "fullscreenchange",
    fullscreen: index % 2 === 0,
    videoTime: index,
    stageTimeElapsed: index,
  }));
  initial.push(
    ...Array.from(
      { length: 100 },
      (_, index): VideoEvent => ({
        type: "play",
        videoTime: index,
        stageTimeElapsed: index,
      }),
    ),
  );
  const telemetry = createMediaStateTelemetry(initial, { fullscreenchange: 3 });
  for (let index = 0; index < 4; index++)
    telemetry.queue({
      type: "fullscreenchange",
      fullscreen: index % 2 === 0,
      videoTime: index + 50,
      stageTimeElapsed: index + 50,
    });
  for (let index = 0; index < 52; index++)
    telemetry.queue({
      type: "enterpictureinpicture",
      videoTime: index,
      stageTimeElapsed: index,
    });
  const first = telemetry.drain();
  expect(
    first.filter((event) => event.type === "fullscreenchange"),
  ).toHaveLength(1);
  expect(
    first.filter((event) => event.type === "enterpictureinpicture"),
  ).toHaveLength(50);
  expect(telemetry.droppedCounts()).toEqual({
    volumechange: 0,
    fullscreenchange: 6,
    enterpictureinpicture: 2,
    leavepictureinpicture: 0,
  });
  const restored = createMediaStateTelemetry(
    [...initial, ...first],
    telemetry.droppedCounts(),
  );
  restored.queue({
    type: "fullscreenchange",
    fullscreen: false,
    videoTime: 60,
    stageTimeElapsed: 60,
  });
  expect(restored.drain()).toEqual([]);
  expect(restored.droppedCounts().fullscreenchange).toBe(7);
  expect(initial).toHaveLength(149);
});

it("returned event objects and drop counts cannot mutate later observations", () => {
  const telemetry = createMediaStateTelemetry();
  telemetry.observeAudio(
    { muted: false, volume: 1, channelMuted: [true] },
    () => ({ videoTime: 2, stageTimeElapsed: 3 }),
  );
  const event = telemetry.drain()[0];
  if (event.type !== "volumechange") throw new Error("expected volume event");
  event.channelMuted![0] = false;
  telemetry.observeAudio(
    { muted: false, volume: 1, channelMuted: [true] },
    () => ({ videoTime: 2, stageTimeElapsed: 3 }),
  );
  expect(telemetry.drain()).toEqual([]);
  const counts = telemetry.droppedCounts();
  counts.volumechange = 100;
  expect(telemetry.droppedCounts().volumechange).toBe(0);
});

it("cancellation discards queued and unsettled observations without a later timer", () => {
  const telemetry = createMediaStateTelemetry();
  telemetry.queue({
    type: "enterpictureinpicture",
    videoTime: 1,
    stageTimeElapsed: 1,
  });
  telemetry.observeAudio({ muted: true, volume: 1 }, () => ({
    videoTime: 2,
    stageTimeElapsed: 2,
  }));
  telemetry.cancel();
  telemetry.cancel();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(telemetry.drain()).toEqual([]);
  telemetry.seedAudio({ muted: false, volume: 1 });
  telemetry.observeAudio({ muted: true, volume: 1 }, () => ({
    videoTime: 3,
    stageTimeElapsed: 3,
  }));
  expect(telemetry.drain()).toHaveLength(1);
});
