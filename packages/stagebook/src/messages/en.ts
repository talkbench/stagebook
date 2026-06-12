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
};
