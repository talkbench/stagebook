// Where a MediaPlayer's clip ends, and whether playback is there (#684).
// No React/DOM deps.
import { seekWindow } from "../../playback/windowedHandle.js";

/**
 * How far short of the end a player's own "ended" report still counts as the
 * end. YouTube can report a time slightly short of its duration once it ends;
 * past this, the participant has sought back and play should resume there.
 */
const ENDED_SLACK_SECONDS = 0.5;

/**
 * The clip as authored: `[startAt, stopAt]`, defaulting to the whole file.
 * Unlike the seek window, this ignores `allowScrubOutsideBounds` — playback
 * still stops at `stopAt`, and a replay still starts at `startAt`.
 */
export function clipWindow(
  startAt: number | undefined,
  stopAt: number | undefined,
  duration: number,
): { start: number; end: number } {
  return seekWindow(
    { startAt, stopAt, allowScrubOutsideBounds: false },
    duration,
  );
}

/**
 * Whether playback sits at the end of the clip, so play should replay it
 * from the start. `ended` is the player's own natural-end state.
 */
export function atClipEnd(
  time: number,
  ended: boolean,
  clip: { start: number; end: number },
): boolean {
  if (time >= clip.end) return true;
  return ended && time >= clip.end - ENDED_SLACK_SECONDS;
}
