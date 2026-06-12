/**
 * Stagebook chrome message catalog (i18n).
 *
 * Stagebook owns the translation of its *own* participant-facing strings — the
 * same posture as its inline styles and baked-in interaction behavior. Hosts
 * may override individual keys (see `DeepPartial` overrides on the context),
 * but the canonical per-locale catalogs ship here so the same Stagebook version
 * produces an identical participant experience across deployments.
 *
 * Design decisions (see docs/decisions/2026-06-localization.md):
 * - Interpolating keys are **functions** (e.g. `charCount`), not placeholder
 *   strings — per-key parameter types are compiler-checked.
 * - No plural framework: count-bearing strings are phrased count-neutrally
 *   (e.g. "Ranges selected: N"), so each entry is a fixed string (plus numeric
 *   interpolation) with no count→form dependency.
 * - `defaultMessages` is keyed by the **closed** `RegisteredLocale` union, so a
 *   locale missing a key fails to compile.
 */

/** Locales stagebook ships a canonical catalog for. Closed union on purpose:
 *  adding a locale forces a complete catalog (compile-time completeness). The
 *  public `locale` prop stays an open `string` — unknown locales fall back to
 *  `en` at runtime, so adding a locale is never a breaking type change for
 *  consumers. */
export type RegisteredLocale = "en" | "he";

export interface StagebookMessages {
  // --- Form / submit ---
  /** Default submit-button label when the researcher doesn't set `buttonText`. */
  submitButtonDefault: string;
  /** Accessible name for the unanchored slider input. */
  sliderLabel: string;
  /** Instruction shown above the slider before the first click. */
  sliderInstruction: string;
  /** Accessible name for the loading spinner. */
  loadingLabel: string;
  /**
   * Character-counter text. Count-neutral by construction: the noun never
   * inflects on `n`. Four shapes depending on which bounds are configured:
   *   - both bounds:  "(12 / 50-200 characters)"
   *   - min only:     "(12 / 50+ characters required)"
   *   - max only:     "(12 / 200 characters max)"
   *   - neither:      "(12 characters)"
   */
  charCount: (n: number, min?: number, max?: number) => string;

  // --- Timer ---
  /** Accessible name for the stage countdown bar. */
  stageTimerLabel: string;
  /** Accessible value-text for the timer, e.g. "1:23 remaining". */
  timerRemaining: (time: string) => string;

  // --- Status / errors ---
  /** ElementErrorBoundary fallback (rendered on any element render crash). */
  elementErrorFallback: string;
  /** Shown to a participant who has submitted while peers are still working.
   *  Count-neutral: always plural "participants", never "participant(s)". */
  submissionWaiting: string;

  // --- Tracked link ---
  /** Default helper text under a tracked link when none is configured. */
  trackedLinkHelperDefault: string;

  // --- Timeline (annotation) ---
  /** Count-neutral selection summary, e.g. "Ranges selected: 3". */
  rangesSelected: (n: number) => string;
  /** Count-neutral selection summary, e.g. "Points marked: 3". */
  pointsMarked: (n: number) => string;
  /** Hint shown in single-select range mode when a range already exists. */
  singleRangeHint: string;
  /** Accessible name for the timeline region, e.g. "Timeline: speech". */
  timelineLabel: (name: string) => string;
  /** Gutter label fallback when no trackLabels entry exists, e.g. "Track 0". */
  timelineTrackFallback: (index: number) => string;
  timelineZoomIn: string;
  timelineZoomOut: string;
  timelineMuteTrack: (label: string) => string;
  timelineUnmuteTrack: (label: string) => string;
  /** Footer help-button accessible name. */
  timelineShowShortcuts: string;
  /** Help-popover heading. */
  timelineShortcutsTitle: string;
  /** Help-popover dialog accessible name. */
  timelineShortcutsLabel: string;
  /**
   * The keyboard-shortcut tables, one row set per selection mode. Whole-table
   * functions (not per-row keys) so a locale translates the table wholesale —
   * including instruction-style "keys" like "Click and drag". Physical key
   * names (Space, Tab, Delete, …) may stay untranslated at the translator's
   * discretion.
   */
  timelineShortcutRowsRange: () => { keys: string; description: string }[];
  timelineShortcutRowsPoint: () => { keys: string; description: string }[];

  // --- MediaPlayer ---
  mediaPlayerLabel: string;
  /** Poster-overlay play affordances. */
  mediaPlayVideo: string;
  mediaPlayAudio: string;
  /** Error states. */
  mediaVideoUnavailable: string;
  mediaAudioUnavailable: string;
  mediaInvalidUrl: string;
  /** HTMLMediaElement error-code map (codes 1-4) + fallbacks. */
  mediaErrorAborted: string;
  mediaErrorNetwork: string;
  mediaErrorDecode: string;
  mediaErrorFormat: string;
  mediaErrorUnknown: string;
  mediaErrorCode: (code: number) => string;
  /** Transport controls — aria-labels and (keyboard-hint-bearing) titles.
   *  "Full" titles belong to the native video controls (hold-to-scrub
   *  supported); "Mini" to the YouTube variant (click-only). */
  mediaSeekBack: string;
  mediaSeekForward: string;
  mediaSeekBackTitleFull: string;
  mediaSeekForwardTitleFull: string;
  mediaSeekBackTitleMini: string;
  mediaSeekForwardTitleMini: string;
  mediaStepBack: (seconds: number) => string;
  mediaStepBackTitle: (seconds: number) => string;
  mediaStepForward: (seconds: number) => string;
  mediaStepForwardTitle: (seconds: number) => string;
  mediaPlay: string;
  mediaPause: string;
  mediaPlayTitle: string;
  mediaPauseTitle: string;
  mediaSpeedLabel: string;
  mediaSpeedTitle: string;
  /** Scrub-bar slider accessible name. */
  mediaSeekSlider: string;
}

/** Recursive partial — host overrides supply any subset of the catalog. The
 *  catalog is flat today, but `DeepPartial` keeps overrides future-proof if a
 *  nested group is ever added. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};
