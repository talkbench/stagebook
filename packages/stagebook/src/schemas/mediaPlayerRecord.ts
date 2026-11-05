/** Authoritative playback-record contract for typing and host CI, not a save gate. */
import { z } from "zod";

const finiteNumber = z.number().finite();
const nonnegativeCount = finiteNumber.int().nonnegative();
const audioStateShape = {
  /** null means the backend could not report this property. */
  muted: z.boolean().nullable(),
  /** Element/backend volume, normalized to [0, 1]; not system volume. */
  volume: finiteNumber.min(0).max(1).nullable(),
  /** Player-owned channel gain mutes, in playback-handle channel order. */
  channelMuted: z.array(z.boolean()).optional(),
};
const optionalAudioStateShape = {
  muted: audioStateShape.muted.optional(),
  volume: audioStateShape.volume.optional(),
  channelMuted: audioStateShape.channelMuted,
};

export type MediaAudioState = z.infer<z.ZodObject<typeof audioStateShape>>;

export const MEDIA_STATE_EVENT_TYPES = [
  "volumechange",
  "fullscreenchange",
  "enterpictureinpicture",
  "leavepictureinpicture",
] as const;
export type MediaStateEventType = (typeof MEDIA_STATE_EVENT_TYPES)[number];

const mediaStateEventCountsSchema = z
  .object({
    volumechange: nonnegativeCount,
    fullscreenchange: nonnegativeCount,
    enterpictureinpicture: nonnegativeCount,
    leavepictureinpicture: nonnegativeCount,
  })
  .strict();
export type MediaStateEventCounts = z.infer<typeof mediaStateEventCountsSchema>;

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
    type: z.literal("play"),
    // Historical play events predate these observations.
    ...optionalAudioStateShape,
  }),
  videoEventBaseSchema.extend({
    // `removed`: playback closed when the player left the page (#677).
    // `restored`: a new session starts; any unclosed playback is discarded (#728).
    type: z.enum(["pause", "ended", "stopAt", "removed", "restored"]),
  }),
  videoEventBaseSchema.extend({
    type: z.literal("seek"),
    fromTime: finiteNumber,
  }),
  videoEventBaseSchema.extend({
    type: z.literal("speed"),
    playbackRate: finiteNumber,
  }),
  videoEventBaseSchema.extend({
    type: z.literal("volumechange"),
    ...audioStateShape,
  }),
  videoEventBaseSchema.extend({
    type: z.literal("fullscreenchange"),
    fullscreen: z.boolean(),
  }),
  videoEventBaseSchema.extend({
    type: z.enum(["enterpictureinpicture", "leavepictureinpicture"]),
  }),
]);
export type VideoEvent = z.infer<typeof videoEventSchema>;
export type MediaStateEvent = Extract<
  VideoEvent,
  { type: MediaStateEventType }
>;

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
    /** Observed playback wall time; hidden and unfocused periods can overlap. */
    hiddenPlaybackSeconds: finiteNumber.nonnegative().optional(),
    unfocusedPlaybackSeconds: finiteNumber.nonnegative().optional(),
    visibilityChangesDuringPlayback: nonnegativeCount.optional(),
    /** Only the added media-state event kinds are capped; transport is unchanged. */
    mediaStateEventsDropped: mediaStateEventCountsSchema.optional(),
    /** Absent until playback starts (#710). */
    firstPlay: videoEventBaseSchema
      .extend({ type: z.literal("play"), ...optionalAudioStateShape })
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
