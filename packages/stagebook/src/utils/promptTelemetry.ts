/** Prompt interaction telemetry shared by browser controls and record builders. */
export interface FieldTiming {
  version: 1;
  /** Monotonic mount-to-first-focus milliseconds; null when unobserved. */
  firstFocusDelayMs: number | null;
  /** Host stage seconds at first focus; null without a valid observation. */
  firstFocusStageTimeElapsed: number | null;
}

export interface TypingStats extends Partial<InputStats> {
  type: "typingStats";
  totalKeystrokes: number;
  // Backspace + Delete — both are participant edits to previously-typed text
  // and contribute identically to keystroke timing.
  editingKeyCount: number;
  arrowKeyCount: number;
  mouseClickCount: number;
  focusCount: number;
  blurCount: number;
  avgInterval: number;
  stdDev: number;
  // 21 values at the 0%, 5%, 10%, ..., 95%, 100% quantiles of inter-keystroke
  // intervals (ms). null when fewer than 2 keystrokes (and thus zero
  // intervals) have been recorded. With ≥2 keystrokes the vector is always
  // 21 values long; a degenerate single-interval distribution emits 21
  // identical values.
  intervalQuantiles: number[] | null;
  firstKeystrokeDelayMs: number | null;
  totalTypingTimeMs: number | null;
  focusedDurationMs: number;
}

/** New measurements are optional on historical/host-created TypingStats. */
export interface InputStats {
  inputEventCount: number;
  beforeInputEventCount: number;
  /** Sparse counts with a fixed input-type vocabulary; unknown types use other. */
  inputTypeCounts: Partial<Record<TypingInputType, number>>;
  charsInsertedByInputType: Partial<Record<TypingInputType, number>>;
  /** Gross observed DOM edits in UTF-16 units, before control validation. */
  charsInsertedTotal: number;
  charsDeletedTotal: number;
  maxSingleInsertionChars: number;
  largeInsertionCount: number;
  largeInsertions: LargeInsertion[];
  untrustedInputEventCount: number;
  inputWithoutKeydownCount: number;
  inputEventsWithoutBeforeInput: number;
  inputEventsWithoutData: number;
  /** Edits estimated from the minimal contiguous before/after value difference. */
  inputDiffFallbackCount: number;
  unidentifiedKeyCount: number;
  processKeyCount: number;
  compositionCount: number;
  /** Ctrl/Meta keydowns that also contribute to the legacy totalKeystrokes. */
  shortcutKeyCount: number;
  copyCount: number;
  cutCount: number;
  firstInputDelayMs: number | null;
  totalInputTimeMs: number | null;
}

export interface LargeInsertion {
  timestamp: number;
  msSinceFirstFocus: number | null;
  msSinceLastFocus: number | null;
  msSinceLastKeydown: number | null;
  chars: number;
  inputType: TypingInputType;
  isTrusted: boolean;
  isComposing: boolean;
  precededByKeydown: boolean;
}

// Include the Input Events vocabulary and the nonstandard dictation spelling
// when supplied by a browser. Missing/new/arbitrary values never grow a map.
export const TYPING_INPUT_TYPES = [
  "insertText",
  "insertReplacementText",
  "insertLineBreak",
  "insertParagraph",
  "insertOrderedList",
  "insertUnorderedList",
  "insertHorizontalRule",
  "insertFromYank",
  "insertFromDrop",
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertTranspose",
  "insertCompositionText",
  "insertFromComposition",
  "insertFromDictation",
  "insertLink",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteEntireSoftLine",
  "deleteHardLineBackward",
  "deleteHardLineForward",
  "deleteByDrag",
  "deleteByCut",
  "deleteContent",
  "deleteContentBackward",
  "deleteContentForward",
  "deleteCompositionText",
  "deleteByComposition",
  "historyUndo",
  "historyRedo",
  "formatBold",
  "formatItalic",
  "formatUnderline",
  "formatStrikeThrough",
  "formatSuperscript",
  "formatSubscript",
  "formatJustifyFull",
  "formatJustifyCenter",
  "formatJustifyRight",
  "formatJustifyLeft",
  "formatIndent",
  "formatOutdent",
  "formatRemove",
  "formatSetBlockTextDirection",
  "formatSetInlineTextDirection",
  "formatBackColor",
  "formatFontColor",
  "formatFontName",
  "other",
] as const;

export type TypingInputType = (typeof TYPING_INPUT_TYPES)[number];

export interface PasteAttempt {
  type: "pasteAttempt";
  length: number;
  timestamp: number;
}

export type DebugMessage = TypingStats | PasteAttempt;
