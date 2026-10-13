/** Authoritative playback-record contract for typing and host CI, not a save gate. */
import { z } from "zod";

const finiteNumber = z.number().finite();

export const videoEventSchema = z
  .object({
    // `removed`: playback closed when the player left the page (#677).
    type: z.enum([
      "play",
      "pause",
      "ended",
      "seek",
      "speed",
      "stopAt",
      "removed",
    ]),
    videoTime: finiteNumber,
    stageTimeElapsed: finiteNumber,
    /** Present on seek events: the position before seeking. */
    fromTime: finiteNumber.optional(),
    /** Present on speed events: the new playback rate. */
    playbackRate: finiteNumber.optional(),
  })
  .passthrough();
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
    firstPlay: videoEventSchema.optional(),
    /** First ended or stopAt event; absent until playback reaches the end. */
    firstEnd: videoEventSchema.optional(),
    // Element adds these fields; standalone MediaPlayer does not need to.
    step: z.string().optional(),
    stageTimeElapsed: finiteNumber.optional(),
  })
  .passthrough();
export type VideoPlaybackRecord = z.infer<typeof mediaPlayerRecordSchema>;
