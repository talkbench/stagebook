import {
  MEDIA_STATE_EVENT_TYPES,
  type MediaAudioState,
  type MediaStateEvent,
  type MediaStateEventCounts,
  type VideoEvent,
} from "../../../schemas/mediaPlayerRecord.js";

export type {
  MediaAudioState,
  MediaStateEvent,
  MediaStateEventCounts,
} from "../../../schemas/mediaPlayerRecord.js";

const EVENT_LIMIT = 50;
const SETTLE_MS = 500;
const emptyCounts = (): MediaStateEventCounts => ({
  volumechange: 0,
  fullscreenchange: 0,
  enterpictureinpicture: 0,
  leavepictureinpicture: 0,
});
const copyAudio = (state: MediaAudioState): MediaAudioState => ({
  muted: state.muted,
  volume: state.volume,
  ...(state.channelMuted !== undefined
    ? { channelMuted: [...state.channelMuted] }
    : {}),
});

function sameAudio(a: MediaAudioState, b: MediaAudioState): boolean {
  return (
    a.muted === b.muted &&
    a.volume === b.volume &&
    a.channelMuted?.length === b.channelMuted?.length &&
    (a.channelMuted?.every(
      (muted, index) => muted === b.channelMuted?.[index],
    ) ??
      true)
  );
}

/**
 * Bounded observations waiting for an existing playback save. Settling a volume
 * drag only updates memory; this helper has no host callback or save mechanism.
 * Caps span restored history and all batches drained during this source's log.
 */
export function createMediaStateTelemetry(
  initialEvents: readonly VideoEvent[] = [],
  initialDropped: Partial<MediaStateEventCounts> = {},
) {
  const retained = emptyCounts();
  const dropped = emptyCounts();
  for (const type of MEDIA_STATE_EVENT_TYPES) {
    retained[type] = initialEvents.filter(
      (event) => event.type === type,
    ).length;
    dropped[type] = initialDropped[type] ?? 0;
  }
  let queued: MediaStateEvent[] = [];
  let lastAudio: MediaAudioState | undefined;
  let pending: Extract<MediaStateEvent, { type: "volumechange" }> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const append = (event: MediaStateEvent) => {
    if (retained[event.type] >= EVENT_LIMIT) {
      dropped[event.type] += 1;
      return;
    }
    retained[event.type] += 1;
    queued.push(
      event.type === "volumechange"
        ? { ...event, ...copyAudio(event) }
        : { ...event },
    );
  };
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (pending) append(pending);
    pending = undefined;
  };

  return {
    /** Establish an observed baseline without inventing a change event. */
    seedAudio(state: MediaAudioState) {
      lastAudio = copyAudio(state);
    },
    observeAudio(
      state: MediaAudioState,
      getTiming: () => { videoTime: number; stageTimeElapsed: number },
    ) {
      if (lastAudio && sameAudio(lastAudio, state)) return;
      lastAudio = copyAudio(state);
      pending = { type: "volumechange", ...copyAudio(state), ...getTiming() };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, SETTLE_MS);
    },
    queue(event: MediaStateEvent) {
      flush();
      append(event);
    },
    flush,
    /** The save boundary also settles an unfinished slider gesture. */
    drain(): MediaStateEvent[] {
      flush();
      const events = queued;
      queued = [];
      return events;
    },
    droppedCounts: (): MediaStateEventCounts => ({ ...dropped }),
    /** Discard an unsaved tail without adding an unmount-only write. */
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
      queued = [];
      lastAudio = undefined;
    },
  };
}
