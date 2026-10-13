/** Authoritative playback-record contract for typing and host CI, not a save gate. */
import { z } from "zod";

const finiteNumber = z.number().finite();

const videoEventBaseSchema = z
  .object({
    videoTime: finiteNumber,
    stageTimeElapsed: finiteNumber,
    /** Present on seek events: the position before seeking. */
    fromTime: finiteNumber.optional(),
    /** Present on speed events: the new playback rate. */
    playbackRate: finiteNumber.optional(),
  })
  .passthrough();

export const videoEventSchema = z.discriminatedUnion("type", [
  videoEventBaseSchema.extend({
    // `removed`: playback closed when the player left the page (#677).
    type: z.enum(["play", "pause", "ended", "stopAt", "removed"]),
  }),
  videoEventBaseSchema.extend({
    type: z.literal("seek"),
    fromTime: finiteNumber,
  }),
  videoEventBaseSchema.extend({
    type: z.literal("speed"),
    playbackRate: finiteNumber,
  }),
]);
export type VideoEvent = z.infer<typeof videoEventSchema>;

export const mediaPlayerRecordSchema = z
  .object({
    name: z.string(),
    url: z.string(),
    startAt: finiteNumber.optional(),
    stopAt: finiteNumber.optional(),
    events: z.array(videoEventSchema),
    lastVideoTime: finiteNumber,
    /** Merged closed intervals [startSeconds, endSeconds] from the event log. */
    watchedRanges: z.array(z.tuple([finiteNumber, finiteNumber])),
    /** Absent until playback starts (#710). */
    firstPlay: videoEventBaseSchema
      .extend({ type: z.literal("play") })
      .optional(),
    /** First ended or stopAt event; absent until playback reaches the end. */
    firstEnd: videoEventBaseSchema
      .extend({ type: z.enum(["ended", "stopAt"]) })
      .optional(),
    // Element adds these fields; standalone MediaPlayer does not need to.
    step: z.string().optional(),
    stageTimeElapsed: finiteNumber.optional(),
  })
  .passthrough();
export type VideoPlaybackRecord = z.infer<typeof mediaPlayerRecordSchema>;
