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
    // `restored`: a new session starts; any unclosed playback is discarded (#728).
    type: z.enum(["play", "pause", "ended", "stopAt", "removed", "restored"]),
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
    /** Stable authored asset identity, independent of resolved/signed URLs. */
    sourceId: z.string().optional(),
    startAt: finiteNumber.optional(),
    stopAt: finiteNumber.optional(),
    /** Full media duration, absent until known. */
    duration: finiteNumber.nonnegative().optional(),
    events: z.array(videoEventSchema),
    lastVideoTime: finiteNumber,
    /** Merged closed intervals [startSeconds, endSeconds] from the event log. */
    watchedRanges: z.array(z.tuple([finiteNumber, finiteNumber])),
    /** Unique watched media seconds inside the authored playback window. */
    watchedSeconds: finiteNumber.nonnegative().optional(),
    /** Window coverage, absent until its duration is known and positive. */
    watchedFraction: finiteNumber.min(0).max(1).optional(),
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
