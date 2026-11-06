import { describe, expect, it } from "vitest";
import { checkHostRecord } from "./hostRecords.js";
import {
  mediaPlayerRecordSchema,
  videoEventSchema,
  type VideoPlaybackRecord,
} from "./mediaPlayerRecord.js";

const play = { type: "play", videoTime: 0, stageTimeElapsed: 2 } as const;
const record: VideoPlaybackRecord = {
  name: "clip",
  url: "https://example.com/clip.mp4",
  events: [play],
  lastVideoTime: 0,
  watchedRanges: [],
  firstPlay: play,
};

describe("mediaPlayerRecordSchema", () => {
  it.each([
    {
      type: "volumechange",
      muted: true,
      volume: 0.25,
      channelMuted: [false, true],
    },
    { type: "volumechange", muted: null, volume: null },
    { type: "fullscreenchange", fullscreen: true },
    { type: "fullscreenchange", fullscreen: false },
    { type: "enterpictureinpicture" },
    { type: "leavepictureinpicture" },
  ])("accepts observational media state events: %j", (fields) => {
    const event = { ...play, ...fields };
    expect(videoEventSchema.parse(event)).toEqual(event);
  });

  it("accepts audio state on play and firstPlay while preserving old records", () => {
    const observed = {
      ...play,
      muted: false,
      volume: 0,
      channelMuted: [true, false],
    };
    expect(
      mediaPlayerRecordSchema.parse({
        ...record,
        events: [observed],
        firstPlay: observed,
      }),
    ).toMatchObject({ events: [observed], firstPlay: observed });
    expect(mediaPlayerRecordSchema.safeParse(record).success).toBe(true);
    expect(
      videoEventSchema.safeParse({ ...play, muted: null, volume: null })
        .success,
    ).toBe(true);
  });

  it.each([
    { type: "play", muted: "yes" },
    { type: "play", volume: -0.01 },
    { type: "play", volume: 1.01 },
    { type: "play", channelMuted: [1] },
    { type: "volumechange", muted: false },
    { type: "volumechange", volume: 1 },
    { type: "volumechange", muted: false, volume: Infinity },
    { type: "fullscreenchange" },
    { type: "fullscreenchange", fullscreen: 1 },
  ])("rejects malformed media state payloads: %j", (fields) => {
    expect(videoEventSchema.safeParse({ ...play, ...fields }).success).toBe(
      false,
    );
  });

  it("types playback visibility totals and bounded-event drop counts", () => {
    const fields = {
      hiddenPlaybackSeconds: 2.5,
      unfocusedPlaybackSeconds: 3.25,
      visibilityChangesDuringPlayback: 2,
      mediaStateEventsDropped: {
        volumechange: 4,
        fullscreenchange: 0,
        enterpictureinpicture: 1,
        leavepictureinpicture: 0,
      },
    };
    expect(
      mediaPlayerRecordSchema.parse({ ...record, ...fields }),
    ).toMatchObject(fields);
  });

  it("restores playback history when a newer writer adds a dropped-event kind", () => {
    const knownCounts = {
      volumechange: 4,
      fullscreenchange: 0,
      enterpictureinpicture: 1,
      leavepictureinpicture: 0,
    };
    const savedRecord = {
      ...record,
      events: [play, { type: "pause", videoTime: 12, stageTimeElapsed: 14 }],
      lastVideoTime: 12,
      watchedRanges: [[0, 12]],
      mediaStateEventsDropped: { ...knownCounts, ratechange: 0 },
    };

    expect(mediaPlayerRecordSchema.parse(savedRecord)).toEqual({
      ...savedRecord,
      mediaStateEventsDropped: knownCounts,
    });
  });

  it.each([-1, 0.5, Infinity, NaN, "1", undefined])(
    "rejects an invalid known dropped-event count: %s",
    (volumechange) => {
      expect(
        mediaPlayerRecordSchema.safeParse({
          ...record,
          mediaStateEventsDropped: {
            volumechange,
            fullscreenchange: 0,
            enterpictureinpicture: 0,
            leavepictureinpicture: 0,
            ratechange: 0,
          },
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    { hiddenPlaybackSeconds: -1 },
    { hiddenPlaybackSeconds: Infinity },
    { unfocusedPlaybackSeconds: "2" },
    { visibilityChangesDuringPlayback: 0.5 },
    { visibilityChangesDuringPlayback: -1 },
    {
      mediaStateEventsDropped: {
        volumechange: -1,
        fullscreenchange: 0,
        enterpictureinpicture: 0,
        leavepictureinpicture: 0,
      },
    },
  ])("rejects malformed media totals: %j", (fields) => {
    expect(
      mediaPlayerRecordSchema.safeParse({ ...record, ...fields }).success,
    ).toBe(false);
  });

  it("accepts saved playback records and optional Element metadata", () => {
    expect(mediaPlayerRecordSchema.safeParse(record).success).toBe(true);
    expect(
      mediaPlayerRecordSchema.safeParse({
        ...record,
        startAt: 0,
        stopAt: 12,
        firstEnd: { type: "stopAt", videoTime: 12, stageTimeElapsed: 14 },
        watchedRanges: [[0, 12]],
        duration: 30,
        sourceId: "clips/example.mp4",
        watchedSeconds: 12,
        watchedFraction: 1,
        step: "watch",
        stageTimeElapsed: 14,
        hostExtension: true,
      }).success,
    ).toBe(true);
  });

  it("does not require milestones before playback reaches them", () => {
    const beforePlay = { ...record };
    delete beforePlay.firstPlay;
    expect(mediaPlayerRecordSchema.safeParse(beforePlay).success).toBe(true);
  });

  it.each(["ended", "stopAt"])(
    "accepts the %s event as the firstEnd milestone",
    (type) => {
      expect(
        checkHostRecord("mediaPlayer", {
          ...record,
          firstEnd: { ...play, type },
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    ["firstPlay", "pause"],
    ["firstPlay", "ended"],
    ["firstPlay", "seek"],
    ["firstPlay", "speed"],
    ["firstPlay", "stopAt"],
    ["firstPlay", "removed"],
    ["firstPlay", "restored"],
    ["firstEnd", "play"],
    ["firstEnd", "pause"],
    ["firstEnd", "seek"],
    ["firstEnd", "speed"],
    ["firstEnd", "removed"],
    ["firstEnd", "restored"],
  ])("rejects %s containing a %s event", (milestone, type) => {
    const result = checkHostRecord("mediaPlayer", {
      ...record,
      [milestone]: { ...play, type },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: [milestone, "type"] }),
      ]);
    }
  });

  it.each([
    "play",
    "pause",
    "ended",
    "seek",
    "speed",
    "stopAt",
    "removed",
    "restored",
  ])("accepts the %s event type", (type) => {
    expect(
      videoEventSchema.safeParse({
        ...play,
        type,
        fromTime: 2,
        playbackRate: 1,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["seek", "fromTime"],
    ["speed", "playbackRate"],
  ])("requires %s events to include %s", (type, field) => {
    const event = { ...play, type };
    expect(videoEventSchema.safeParse(event).success).toBe(false);
    const result = checkHostRecord("mediaPlayer", {
      ...record,
      events: [event],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ["events", 0, field] }),
      ]);
    }
  });

  it.each([
    { type: "seek", fromTime: 0 },
    { type: "speed", playbackRate: 1.5 },
  ])("accepts the required event payload: %j", (fields) => {
    const event = { ...play, ...fields, hostExtension: "preserved" };
    expect(videoEventSchema.parse(event)).toEqual(event);
  });

  it.each(["play", "pause", "ended", "stopAt", "removed", "restored"])(
    "does not require seek or speed payloads on %s events",
    (type) => {
      expect(videoEventSchema.safeParse({ ...play, type }).success).toBe(true);
    },
  );

  it("accepts zero coverage and unknown duration without rejecting legacy records", () => {
    expect(mediaPlayerRecordSchema.safeParse(record).success).toBe(true);
    expect(
      mediaPlayerRecordSchema.safeParse({
        ...record,
        duration: 0,
        watchedSeconds: 0,
        watchedFraction: 0,
      }).success,
    ).toBe(true);
  });

  it.each([
    { duration: -1 },
    { duration: Infinity },
    { duration: NaN },
    { duration: "12" },
    { sourceId: 12 },
    { watchedSeconds: -1 },
    { watchedSeconds: Infinity },
    { watchedSeconds: NaN },
    { watchedSeconds: "12" },
    { watchedFraction: -0.01 },
    { watchedFraction: 1.01 },
    { watchedFraction: Infinity },
    { watchedFraction: NaN },
    { watchedFraction: "0.5" },
  ])("rejects malformed coverage fields: %j", (fields) => {
    expect(
      mediaPlayerRecordSchema.safeParse({ ...record, ...fields }).success,
    ).toBe(false);
  });

  it.each([
    { type: "seek", fromTime: undefined },
    { type: "seek", fromTime: null },
    { type: "seek", fromTime: "0" },
    { type: "seek", fromTime: Infinity },
    { type: "speed", playbackRate: undefined },
    { type: "speed", playbackRate: null },
    { type: "speed", playbackRate: "1.5" },
    { type: "speed", playbackRate: NaN },
  ])("rejects malformed event payloads: %j", (fields) => {
    expect(videoEventSchema.safeParse({ ...play, ...fields }).success).toBe(
      false,
    );
  });

  it.each([
    { events: [{ ...play, type: "firstplay" }] },
    { lastVideoTime: "12" },
    { watchedRanges: [[0]] },
    { watchedRanges: [[0, 1, 2]] },
    { watchedRanges: [[0, Infinity]] },
    { firstPlay: { ...play, stageTimeElapsed: NaN } },
  ])("rejects malformed saved fields: %j", (fields) => {
    expect(
      mediaPlayerRecordSchema.safeParse({ ...record, ...fields }).success,
    ).toBe(false);
  });
});
