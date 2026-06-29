import type { StagebookMessages } from "./types.js";

/**
 * English catalog — the canonical source of truth for stagebook's chrome
 * strings, and the fallback for any unknown locale.
 *
 * Count-bearing strings are phrased count-neutrally (no singular/plural noun
 * inflection on the count) so no plural framework is needed; translators must
 * preserve that property (see the localization translator guideline).
 */
export const en: StagebookMessages = {
  submitButtonDefault: "Next",
  sliderLabel: "Slider",
  sliderInstruction: "Click the bar to select a value, then drag to adjust.",
  loadingLabel: "Loading",
  charCount: (n, min, max) => {
    if (min !== undefined && max !== undefined) {
      return `(${n} / ${min}-${max} characters)`;
    }
    if (min !== undefined) {
      return `(${n} / ${min}+ characters required)`;
    }
    if (max !== undefined) {
      return `(${n} / ${max} characters max)`;
    }
    return `(${n} characters)`;
  },

  stageTimerLabel: "Stage timer",
  timerRemaining: (time) => `${time} remaining`,

  elementErrorFallback:
    "Part of this page couldn't load. The rest is still usable.",
  submissionWaiting: "Waiting for other participants to finish this stage.",

  trackedLinkHelperDefault:
    "Link opens in a new tab. Return to this tab to complete the study.",

  rangesSelected: (n) => `Ranges selected: ${n}`,
  pointsMarked: (n) => `Points marked: ${n}`,
  singleRangeHint: "Max 1 range — delete to replace",
  timelineLabel: (name) => `Timeline: ${name}`,
  timelineTrackFallback: (index) => `Track ${index}`,
  timelineZoomIn: "Zoom in",
  timelineZoomOut: "Zoom out",
  timelineMuteTrack: (label) => `Mute ${label}`,
  timelineUnmuteTrack: (label) => `Unmute ${label}`,
  timelineShowShortcuts: "Show keyboard shortcuts",
  timelineShortcutsTitle: "Keyboard shortcuts",
  timelineShortcutsLabel: "Timeline keyboard shortcuts",
  timelineShortcutRowsRange: () => [
    { keys: "Space", description: "Play / Pause" },
    { keys: "Click empty space", description: "Seek playhead" },
    { keys: "←  → (no selection)", description: "Scrub playhead ±1s" },
    { keys: ", . (no selection)", description: "Scrub ±1 frame" },
    { keys: "Click and drag", description: "Create range" },
    {
      keys: "Enter (press and hold)",
      description: "Mark range while watching",
    },
    { keys: "Click range", description: "Select it" },
    { keys: "Drag handle", description: "Adjust boundary" },
    { keys: "←  →", description: "Adjust handle ±1s" },
    { keys: ", .", description: "Adjust ±1 frame" },
    { keys: "Tab", description: "Switch handle" },
    { keys: "Delete", description: "Remove range" },
    { keys: "Ctrl+Z / Cmd+Z", description: "Undo" },
    { keys: "Escape", description: "Deselect" },
  ],
  timelineShortcutRowsPoint: () => [
    { keys: "Space", description: "Play / Pause" },
    { keys: "Click empty space", description: "Place point" },
    { keys: "Enter", description: "Place point at playhead" },
    { keys: "←  → (no selection)", description: "Scrub playhead ±1s" },
    { keys: ", . (no selection)", description: "Scrub ±1 frame" },
    { keys: "Click point", description: "Select it" },
    { keys: "Drag point", description: "Reposition" },
    { keys: "←  →", description: "Reposition ±1s" },
    { keys: ", .", description: "Reposition ±1 frame" },
    { keys: "Delete", description: "Remove point" },
    { keys: "Ctrl+Z / Cmd+Z", description: "Undo" },
    { keys: "Escape", description: "Deselect" },
  ],

  mediaPlayerLabel: "Media player",
  mediaPlayVideo: "Play video",
  mediaPlayAudio: "Play audio",
  mediaVideoUnavailable: "Video unavailable",
  mediaAudioUnavailable: "Audio unavailable",
  mediaInvalidUrl: "Invalid media URL",
  mediaErrorAborted: "Loading was aborted",
  mediaErrorNetwork: "Network error",
  mediaErrorDecode: "Failed to decode video",
  mediaErrorFormat:
    "Video format is not supported (or the file could not be loaded)",
  mediaErrorUnknown: "Unknown error",
  mediaErrorCode: (code) => `Error code ${code}`,
  mediaSeekBack: "Back 1s",
  mediaSeekForward: "Forward 1s",
  mediaSeekBackTitleFull: "Back 1s (←) · Hold to scrub · J for 10s",
  mediaSeekForwardTitleFull: "Forward 1s (→) · Hold to scrub · L for 10s",
  mediaSeekBackTitleMini: "Back 1s · J for 10s",
  mediaSeekForwardTitleMini: "Forward 1s · L for 10s",
  mediaStepBack: (seconds) => `Step back ${seconds}s`,
  mediaStepBackTitle: (seconds) => `Step back ${seconds}s (,)`,
  mediaStepForward: (seconds) => `Step forward ${seconds}s`,
  mediaStepForwardTitle: (seconds) => `Step forward ${seconds}s (.)`,
  mediaPlay: "Play",
  mediaPause: "Pause",
  mediaPlayTitle: "Play (Space)",
  mediaPauseTitle: "Pause (Space)",
  mediaSpeedLabel: "Playback speed",
  mediaSpeedTitle: "Playback speed (< / >)",
  mediaSeekSlider: "Seek",
};
