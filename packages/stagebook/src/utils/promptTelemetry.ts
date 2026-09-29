/** Prompt interaction telemetry shared by browser controls and record builders. */
export interface TypingStats {
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

export interface PasteAttempt {
  type: "pasteAttempt";
  length: number;
  timestamp: number;
}

export type DebugMessage = TypingStats | PasteAttempt;
