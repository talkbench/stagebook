/**
 * YouTube step/speed controls lint (#723).
 *
 * `mediaPlayer.controls` has four switches. For an uploaded media file all four
 * render. For a YouTube `file`, stagebook's control bar has only play/pause
 * and seek: `step` and `speed` have no YouTube implementation, so turning them
 * on does nothing. Worse, since #699 YouTube's own in-frame controls are turned
 * off whenever any of stagebook's controls are on, so a YouTube player with
 * ONLY `step` and/or `speed` shows participants no on-screen control at all.
 *
 * This is a lint (warning), not an error: the treatment still runs. At most one
 * warning per element, anchored on its `controls` key; the message adds the
 * no-visible-control consequence when neither `playPause` nor `seek` is on.
 *
 * Like the missing-alt-text lint (`imageAltText.ts`, #536) it runs as a
 * SEPARATE post-validation check, never in the schema superRefine (a
 * superRefine issue flips `safeParse` to failure for consumers that gate on
 * it). It is wired into the same two places:
 *   - `validateTreatmentSource` (CLI raw + expanded YAML, VS Code expanded
 *     preview);
 *   - `validateTreatmentDiff` (inline editor squiggle on the source object).
 *
 * Skipped when `syncToStageTime: true` or `playback: "once"`: the schema
 * already rejects `controls` there, so this warning would be beside the point.
 *
 * A `file` that is still a `${field}` placeholder isn't a URL yet, so
 * `isYouTubeURL` returns null and the lint stays quiet; it fires on the
 * expanded pass once the placeholder is filled. Same walk as the alt-text
 * lint: concrete containers only, never raw `templates:` bodies.
 */

import { isYouTubeURL } from "../components/elements/mediaPlayer/isYouTubeURL.js";
import { forEachConcreteElement } from "./forEachConcreteElement.js";

export interface YouTubeUnsupportedControls {
  /** Path to the offending element's `controls` within the treatment file. */
  path: (string | number)[];
  /** Human-readable warning. */
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildMessage(
  unsupported: string[],
  hasVisibleControl: boolean,
): string {
  const named = unsupported.map((c) => `\`controls.${c}\``).join(" and ");
  let message =
    `${named} ${unsupported.length > 1 ? "aren't" : "isn't"} available for ` +
    "YouTube videos: stagebook's YouTube player has only play/pause and " +
    "seek. Step and speed controls apply to uploaded media files.";
  if (!hasVisibleControl) {
    message +=
      " With neither `playPause` nor `seek` on, participants will see no " +
      "on-screen control at all (YouTube's own controls are turned off " +
      "whenever stagebook's are on).";
  }
  return message;
}

/**
 * Collect every YouTube `mediaPlayer` whose `controls` turn on `step` or
 * `speed`. Defensive against malformed input (returns `[]`).
 */
export function collectYouTubeUnsupportedControls(
  data: unknown,
): YouTubeUnsupportedControls[] {
  const out: YouTubeUnsupportedControls[] = [];
  forEachConcreteElement(data, (el, path) => {
    if (el.type !== "mediaPlayer" || !isRecord(el.controls)) return;
    // `controls` is already a schema ERROR with either of these
    // (checkMediaPlayerCrossFields); a second diagnostic on the same range
    // about which controls YouTube supports would only be noise.
    if (el.syncToStageTime === true || el.playback === "once") return;
    if (typeof el.file !== "string" || isYouTubeURL(el.file) === null) return;
    const { playPause, seek, step, speed } = el.controls;
    const unsupported = [
      ...(step === true ? ["step"] : []),
      ...(speed === true ? ["speed"] : []),
    ];
    if (unsupported.length === 0) return;
    out.push({
      path: [...path, "controls"],
      message: buildMessage(unsupported, playPause === true || seek === true),
    });
  });
  return out;
}
