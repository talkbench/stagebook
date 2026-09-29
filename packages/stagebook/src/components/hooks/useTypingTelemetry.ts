import { useRef } from "react";
import { computeIntervalQuantiles } from "../form/typingQuantiles.js";
import type { TypingStats } from "../../utils/promptTelemetry.js";

const CURSOR_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

const EDITING_KEYS = new Set(["Backspace", "Delete"]);

/** Identical typing measurements for Stagebook's text and numeric instruments. */
export function useTypingTelemetry() {
  // Inter-keystroke timing comes from character-producing and editing keys
  // (Backspace/Delete). Cursor-only keys (arrows, Home/End) are excluded so
  // that pure navigation doesn't dilute the typing rhythm signal.
  const keystrokeTimestamps = useRef<number[]>([]);

  const editingKeyCount = useRef(0);
  const arrowKeyCount = useRef(0);
  const mouseClickCount = useRef(0);
  const focusCount = useRef(0);
  const blurCount = useRef(0);

  // Time of the very first focus event on this textarea — used to compute
  // firstKeystrokeDelayMs (time the participant stared at the field before
  // typing anything). Set once, never reset.
  const firstFocusAt = useRef<number | null>(null);
  // Start of the current focused interval; null when not focused. Combined
  // with focusedDurationMs to accumulate total focused time across blurs.
  const currentFocusStartedAt = useRef<number | null>(null);
  const focusedDurationMs = useRef(0);

  const computeTypingStats = (): TypingStats => {
    const timestamps = keystrokeTimestamps.current;

    // Accumulated focus duration plus any in-progress focus interval.
    const now = Date.now();
    const liveFocusDelta =
      currentFocusStartedAt.current !== null
        ? now - currentFocusStartedAt.current
        : 0;
    const totalFocusedMs = focusedDurationMs.current + liveFocusDelta;

    let avgInterval = 0;
    let stdDev = 0;
    let intervalQuantiles: number[] | null = null;
    if (timestamps.length >= 2) {
      const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
      avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      stdDev = Math.sqrt(
        intervals
          .map((x) => (x - avgInterval) ** 2)
          .reduce((a, b) => a + b, 0) / intervals.length,
      );
      // intervals is non-empty here (timestamps.length >= 2), so the helper
      // returns a 21-value vector. A single-interval distribution emits 21
      // identical values rather than an empty array.
      intervalQuantiles = computeIntervalQuantiles(intervals);
    }

    const firstKeystrokeDelayMs =
      timestamps.length > 0 && firstFocusAt.current !== null
        ? timestamps[0] - firstFocusAt.current
        : null;

    const totalTypingTimeMs =
      timestamps.length >= 2
        ? timestamps[timestamps.length - 1] - timestamps[0]
        : null;

    return {
      type: "typingStats",
      totalKeystrokes: timestamps.length,
      editingKeyCount: editingKeyCount.current,
      arrowKeyCount: arrowKeyCount.current,
      mouseClickCount: mouseClickCount.current,
      focusCount: focusCount.current,
      blurCount: blurCount.current,
      avgInterval,
      stdDev,
      intervalQuantiles,
      firstKeystrokeDelayMs,
      totalTypingTimeMs,
      focusedDurationMs: totalFocusedMs,
    };
  };

  const onFocus = () => {
    const now = Date.now();
    focusCount.current += 1;
    if (firstFocusAt.current === null) {
      firstFocusAt.current = now;
    }
    currentFocusStartedAt.current = now;
  };

  const onBlur = (): TypingStats => {
    blurCount.current += 1;
    if (currentFocusStartedAt.current !== null) {
      focusedDurationMs.current += Date.now() - currentFocusStartedAt.current;
      currentFocusStartedAt.current = null;
    }

    return computeTypingStats();
  };

  const onKeyDown = (e: { key: string }) => {
    if (CURSOR_KEYS.has(e.key)) {
      arrowKeyCount.current += 1;
      return;
    }
    if (EDITING_KEYS.has(e.key)) {
      editingKeyCount.current += 1;
      keystrokeTimestamps.current.push(Date.now());
      return;
    }
    // Ignore modifier-only events (no character produced); they shouldn't
    // count as keystrokes for rhythm purposes.
    if (e.key.length !== 1 && e.key !== "Enter" && e.key !== "Tab") {
      return;
    }
    keystrokeTimestamps.current.push(Date.now());
  };

  const onClick = () => {
    mouseClickCount.current += 1;
  };

  return { onFocus, onBlur, onKeyDown, onClick };
}
