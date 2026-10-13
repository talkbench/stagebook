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
  it("accepts saved playback records and optional Element metadata", () => {
    expect(mediaPlayerRecordSchema.safeParse(record).success).toBe(true);
    expect(
      mediaPlayerRecordSchema.safeParse({
        ...record,
        startAt: 0,
        stopAt: 12,
        firstEnd: { type: "stopAt", videoTime: 12, stageTimeElapsed: 14 },
        watchedRanges: [[0, 12]],
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
    ["firstEnd", "play"],
    ["firstEnd", "pause"],
    ["firstEnd", "seek"],
    ["firstEnd", "speed"],
    ["firstEnd", "removed"],
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

  it.each(["play", "pause", "ended", "seek", "speed", "stopAt", "removed"])(
    "accepts the %s event type",
    (type) => {
      expect(
        videoEventSchema.safeParse({
          ...play,
          type,
          fromTime: 2,
          playbackRate: 1,
        }).success,
      ).toBe(true);
    },
  );

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
