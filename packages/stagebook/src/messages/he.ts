import type { StagebookMessages } from "./types.js";

const ltr = (value: string | number) => `\u2066${value}\u2069`;

/**
 * Hebrew catalog (RTL).
 *
 * FIRST DRAFT — machine-authored, pending verification by a native Hebrew
 * speaker. Do not treat as final translation quality. Structure (keys, the
 * count-neutral phrasing, interpolation order) is what matters here; wording is
 * to be reviewed.
 */
export const he: StagebookMessages = {
  numberFormat: { decimal: ".", grouping: "," },
  numericGuidance: (integer, min, max) => {
    const kind = integer ? "מספר שלם" : "מספר";
    if (min !== undefined && max !== undefined)
      return `${kind} בין ${ltr(min)} ל־${ltr(max)}`;
    if (min !== undefined) return `${kind} גדול או שווה ל־${ltr(min)}`;
    if (max !== undefined) return `${kind} קטן או שווה ל־${ltr(max)}`;
    return integer ? "יש להזין מספר שלם" : "יש להזין מספר";
  },
  numericLessThan: (value, min) => `${ltr(value)} קטן מ־${ltr(min)}`,
  numericMoreThan: (value, max) => `${ltr(value)} גדול מ־${ltr(max)}`,
  numericWholeNumber: "יש להזין מספר שלם",
  numericUnfinished: "יש להשלים את הזנת המספר",
  numericNotNumber: "יש להזין מספר",
  numericTooManyDigits: "יותר מדי ספרות",
  numericTooLong: "המספר ארוך מדי",
  sharedNumericUnavailable: "אי אפשר להציג כאן את השאלה",
  submitButtonDefault: "הבא",
  promptRequired: "נדרש",
  sliderLabel: "מחוון",
  sliderInstruction: "לחצו על הפס לבחירת ערך, ואז גררו לכוונון.",
  loadingLabel: "טוען",
  charCount: (n, min, max) => {
    if (min !== undefined && max !== undefined) {
      return `(${ltr(`${n} / ${min}-${max}`)} תווים)`;
    }
    if (min !== undefined) {
      return `(${ltr(`${n} / ${min}+`)} תווים נדרשים)`;
    }
    if (max !== undefined) {
      return `(${ltr(`${n} / ${max}`)} תווים לכל היותר)`;
    }
    return `(${ltr(n)} תווים)`;
  },

  stageTimerLabel: "טיימר שלב",
  timerRemaining: (time) => `נותרו ${ltr(time)}`,

  errorTechnicalDetails: "פרטים טכניים",
  promptErrorTitle: "השאלה לא נטענה",
  promptErrorHelp: "נא לפנות לצוות המחקר לקבלת עזרה.",
  elementErrorFallback: "חלק מהדף לא נטען. שאר הדף עדיין שמיש.",
  submissionWaiting: "ממתינים לשאר המשתתפים לסיים שלב זה.",

  trackedLinkHelperDefault:
    "הקישור נפתח בלשונית חדשה. חזרו ללשונית זו כדי להשלים את המחקר.",

  rangesSelected: (n) => `טווחים שנבחרו: ${ltr(n)}`,
  pointsMarked: (n) => `נקודות שסומנו: ${ltr(n)}`,
  singleRangeHint: "טווח אחד לכל היותר — מחקו כדי להחליף",
  timelineLabel: (name) => `ציר זמן: ${name}`,
  timelineTrackFallback: (index) => `רצועה ${ltr(index)}`,
  timelineNavigationHint:
    "השתמשו בסוגריים מרובעים שמאלה וימינה לבחירת הסימון הקודם או הבא בלי להזיז את ראש הניגון. בטווח, Tab בוחר גבול. Escape מבטל את הבחירה כדי לאפשר יציאה מציר הזמן באמצעות Tab.",
  timelineNoAnnotationSelected: (count) =>
    `לא נבחר סימון. מספר הסימונים: ${ltr(count)}.`,
  timelinePointSelected: (position, count, time) =>
    `נקודה ${ltr(position)} מתוך ${ltr(count)}, ${ltr(time)} שניות.`,
  timelineRangeSelected: (position, count, start, end) =>
    `טווח ${ltr(position)} מתוך ${ltr(count)}, ${ltr(start)} עד ${ltr(end)} שניות.`,
  timelineStartBoundarySelected: "גבול ההתחלה נבחר.",
  timelineEndBoundarySelected: "גבול הסיום נבחר.",
  timelineZoomIn: "התקרבות",
  timelineZoomOut: "התרחקות",
  timelineMuteTrack: (label) => `השתקת ${label}`,
  timelineUnmuteTrack: (label) => `ביטול השתקת ${label}`,
  timelineShowShortcuts: "הצגת קיצורי מקלדת",
  timelineShortcutsTitle: "קיצורי מקלדת",
  timelineShortcutsLabel: "קיצורי מקלדת של ציר הזמן",
  timelineCloseShortcuts: "סגירת קיצורי המקלדת",
  timelineShortcutRowsRange: () => [
    { keys: "[ / ]", description: "הסימון הקודם / הבא (בלי הזזת ראש הניגון)" },
    { keys: "Space", description: "ניגון / השהיה" },
    { keys: "לחיצה על שטח ריק", description: "הזזת ראש הניגון" },
    { keys: "←  → (ללא בחירה)", description: "גלילת ראש הניגון ±1 שנ׳" },
    { keys: ", . (ללא בחירה)", description: "גלילה ±1 פריים" },
    { keys: "לחיצה וגרירה", description: "יצירת טווח" },
    { keys: "Enter (לחיצה ממושכת)", description: "סימון טווח תוך כדי צפייה" },
    { keys: "לחיצה על טווח", description: "בחירת הטווח" },
    { keys: "גרירת ידית", description: "כוונון גבול" },
    { keys: "←  →", description: "כוונון ידית ±1 שנ׳" },
    { keys: ", .", description: "כוונון ±1 פריים" },
    { keys: "Tab", description: "החלפת ידית" },
    { keys: "Delete", description: "הסרת טווח" },
    { keys: "Ctrl+Z / Cmd+Z", description: "ביטול פעולה" },
    { keys: "Escape", description: "ביטול בחירה" },
  ],
  timelineShortcutRowsPoint: () => [
    { keys: "[ / ]", description: "הסימון הקודם / הבא (בלי הזזת ראש הניגון)" },
    { keys: "Space", description: "ניגון / השהיה" },
    { keys: "לחיצה על שטח ריק", description: "הצבת נקודה" },
    { keys: "Enter", description: "הצבת נקודה בראש הניגון" },
    { keys: "←  → (ללא בחירה)", description: "גלילת ראש הניגון ±1 שנ׳" },
    { keys: ", . (ללא בחירה)", description: "גלילה ±1 פריים" },
    { keys: "לחיצה על נקודה", description: "בחירת הנקודה" },
    { keys: "גרירת נקודה", description: "מיקום מחדש" },
    { keys: "←  →", description: "מיקום מחדש ±1 שנ׳" },
    { keys: ", .", description: "מיקום מחדש ±1 פריים" },
    { keys: "Delete", description: "הסרת נקודה" },
    { keys: "Ctrl+Z / Cmd+Z", description: "ביטול פעולה" },
    { keys: "Escape", description: "ביטול בחירה" },
  ],

  mediaPlayerLabel: "נגן מדיה",
  mediaPlayVideo: "ניגון וידאו",
  mediaPlayAudio: "ניגון שמע",
  mediaVideoUnavailable: "הווידאו אינו זמין",
  mediaAudioUnavailable: "השמע אינו זמין",
  mediaInvalidUrl: "כתובת מדיה לא תקינה",
  mediaErrorAborted: "הטעינה בוטלה",
  mediaErrorNetwork: "שגיאת רשת",
  mediaErrorDecode: "פענוח הווידאו נכשל",
  mediaErrorFormat: "פורמט הווידאו אינו נתמך (או שלא ניתן היה לטעון את הקובץ)",
  mediaErrorUnknown: "שגיאה לא ידועה",
  mediaErrorCode: (code) => `קוד שגיאה ${ltr(code)}`,
  mediaSeekBack: "שנייה אחורה",
  mediaSeekForward: "שנייה קדימה",
  mediaSeekBackTitleFull: "שנייה אחורה (←) · החזיקו לגלילה · J ל־10 שניות",
  mediaSeekForwardTitleFull: "שנייה קדימה (→) · החזיקו לגלילה · L ל־10 שניות",
  mediaSeekBackTitleMini: "שנייה אחורה · J ל־10 שניות",
  mediaSeekForwardTitleMini: "שנייה קדימה · L ל־10 שניות",
  mediaStepBack: (seconds) => `דילוג ${ltr(seconds)} שניות אחורה`,
  mediaStepBackTitle: (seconds) => `דילוג ${ltr(seconds)} שניות אחורה (,)`,
  mediaStepForward: (seconds) => `דילוג ${ltr(seconds)} שניות קדימה`,
  mediaStepForwardTitle: (seconds) => `דילוג ${ltr(seconds)} שניות קדימה (.)`,
  mediaPlay: "ניגון",
  mediaPause: "השהיה",
  mediaPlayTitle: "ניגון (Space)",
  mediaReplay: "ניגון חוזר",
  mediaReplayTitle: "ניגון חוזר (Space)",
  mediaPauseTitle: "השהיה (Space)",
  mediaSpeedLabel: "מהירות ניגון",
  mediaSpeedTitle: "מהירות ניגון (< / >)",
  mediaSeekSlider: "ניווט בזמן",
};
