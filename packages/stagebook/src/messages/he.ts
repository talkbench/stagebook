import type { StagebookMessages } from "./types.js";

/**
 * Hebrew catalog (RTL).
 *
 * FIRST DRAFT — machine-authored, pending verification by a native Hebrew
 * speaker. Do not treat as final translation quality. Structure (keys, the
 * count-neutral phrasing, interpolation order) is what matters here; wording is
 * to be reviewed.
 */
export const he: StagebookMessages = {
  submitButtonDefault: "הבא",
  sliderLabel: "מחוון",
  loadingLabel: "טוען",
  charCount: (n, min, max) => {
    if (min !== undefined && max !== undefined) {
      return `(${n} / ${min}-${max} תווים)`;
    }
    if (min !== undefined) {
      return `(${n} / ${min}+ תווים נדרשים)`;
    }
    if (max !== undefined) {
      return `(${n} / ${max} תווים לכל היותר)`;
    }
    return `(${n} תווים)`;
  },

  stageTimerLabel: "טיימר שלב",
  timerRemaining: (time) => `נותרו ${time}`,

  elementErrorFallback: "חלק מהדף לא נטען. שאר הדף עדיין שמיש.",
  submissionWaiting: "ממתינים לשאר המשתתפים לסיים שלב זה.",

  trackedLinkHelperDefault:
    "הקישור נפתח בלשונית חדשה. חזרו ללשונית זו כדי להשלים את המחקר.",

  rangesSelected: (n) => `טווחים שנבחרו: ${n}`,
  pointsMarked: (n) => `נקודות שסומנו: ${n}`,
};
