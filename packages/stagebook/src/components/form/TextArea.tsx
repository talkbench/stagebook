import React, { useEffect, useState, useRef, useId } from "react";
import { computeIntervalQuantiles } from "./typingQuantiles.js";

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

export interface TextAreaProps {
  defaultText?: string;
  onChange?: (value: string) => void;
  onDebugMessage?: (message: DebugMessage) => void;
  value?: string;
  rows?: number;
  showCharacterCount?: boolean;
  minLength?: number;
  maxLength?: number;
  debounceDelay?: number;
  id?: string;
}

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

export function TextArea({
  defaultText,
  onChange,
  onDebugMessage,
  value,
  rows = 5,
  showCharacterCount,
  minLength,
  maxLength,
  debounceDelay = 500,
  id,
}: TextAreaProps) {
  const generatedId = useId();
  const textAreaId = id || generatedId;
  const [localValue, setLocalValue] = useState(value || "");
  // Transient flag set when a keystroke is rejected for exceeding maxLength;
  // drives the brief red pulse animation on the character counter. The
  // steady-state color stays valid-green when length === maxLength (#333).
  const [isOverflowing, setIsOverflowing] = useState(false);
  // Bumped on each rejected overflow keystroke. Used as the React `key`
  // on the counter element so that rapid repeat overflows reliably restart
  // the pulse animation — without this, a second overflow within 300ms
  // would not retrigger the keyframe (the animation prop string is
  // unchanged, so the browser doesn't restart).
  const [overflowPulseId, setOverflowPulseId] = useState(0);
  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overflowTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const isDebouncing = useRef(false);

  // Sync with external value only when not actively debouncing
  useEffect(() => {
    if (!isDebouncing.current) {
      setLocalValue(value || "");
    }
  }, [value]);

  // Clear the overflow timeout on unmount — without this, a stage/page
  // change within the 300ms window would fire setIsOverflowing(false) on
  // an unmounted component (silent in React 18+ but still a leak).
  useEffect(() => {
    return () => {
      if (overflowTimeout.current) clearTimeout(overflowTimeout.current);
    };
  }, []);

  const submitChange = (val: string) => {
    if (onChange && typeof onChange === "function") {
      onChange(val);
    }
  };

  const debouncedSubmit = (val: string) => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }
    isDebouncing.current = true;
    debounceTimeout.current = setTimeout(() => {
      isDebouncing.current = false;
      submitChange(val);
    }, debounceDelay);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text");
    if (onDebugMessage) {
      onDebugMessage({
        type: "pasteAttempt",
        length: pastedText.length,
        timestamp: Date.now(),
      });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (maxLength && newValue.length > maxLength) {
      // Keystroke would overflow — reject it and pulse the counter red
      // briefly. Distinguishes "you tried to overflow" (transient, this
      // animation) from "you're at the limit" (steady valid state).
      if (overflowTimeout.current) clearTimeout(overflowTimeout.current);
      setIsOverflowing(true);
      setOverflowPulseId((p) => p + 1);
      overflowTimeout.current = setTimeout(() => {
        setIsOverflowing(false);
      }, 300);
      return;
    }
    setLocalValue(newValue);
    debouncedSubmit(newValue);
  };

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

  const handleFocus = () => {
    const now = Date.now();
    focusCount.current += 1;
    if (firstFocusAt.current === null) {
      firstFocusAt.current = now;
    }
    currentFocusStartedAt.current = now;
  };

  const handleBlur = () => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      isDebouncing.current = false;
    }
    submitChange(localValue);

    blurCount.current += 1;
    if (currentFocusStartedAt.current !== null) {
      focusedDurationMs.current += Date.now() - currentFocusStartedAt.current;
      currentFocusStartedAt.current = null;
    }

    if (onDebugMessage) {
      onDebugMessage(computeTypingStats());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const handleClick = () => {
    mouseClickCount.current += 1;
  };

  const renderCharacterCount = () => {
    if (!showCharacterCount) return null;

    let countText = "";
    let countColor = "var(--stagebook-text-muted, #6b7280)";
    let countState = "default";
    const currentLength = localValue.length;

    if (minLength && maxLength) {
      countText = `(${currentLength} / ${minLength}-${maxLength} characters)`;
      // The valid range is [minLength, maxLength] inclusive on both ends.
      // Hitting maxLength is "you're at the upper limit" — a fact, not an
      // error. Attempts to type past it pulse red via isOverflowing (#333).
      if (currentLength >= minLength && currentLength <= maxLength) {
        countColor = "var(--stagebook-success, #16a34a)";
        countState = "valid";
      }
    } else if (minLength) {
      countText = `(${currentLength} / ${minLength}+ characters required)`;
      if (currentLength >= minLength) {
        countColor = "var(--stagebook-success, #16a34a)";
        countState = "valid";
      }
    } else if (maxLength) {
      countText = `(${currentLength} / ${maxLength} characters max)`;
    } else {
      countText = `(${currentLength} characters)`;
    }

    // Pulse animation takes priority over the steady-state color — when the
    // participant tries to type past maxLength, the counter flashes red for
    // 300ms regardless of the underlying valid state.
    const animationStyle = isOverflowing
      ? { animation: "stagebook-char-counter-pulse 300ms ease-out" }
      : {};
    const overflowState = isOverflowing ? "overflow" : countState;

    return (
      <div
        key={isOverflowing ? `pulse-${overflowPulseId}` : "steady"}
        data-testid="char-counter"
        data-state={overflowState}
        style={{
          textAlign: "right",
          fontSize: "0.75rem",
          marginTop: "0.25rem",
          paddingRight: "0.75rem",
          color: countColor,
          boxSizing: "border-box",
          width: "100%",
          ...animationStyle,
        }}
      >
        {countText}
      </div>
    );
  };

  return (
    <div
      style={{ position: "relative", width: "100%", boxSizing: "border-box" }}
    >
      <textarea
        id={textAreaId}
        autoComplete="off"
        rows={rows}
        placeholder={defaultText}
        value={localValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleClick}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        style={{
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          padding: "0.5rem 0.75rem",
          border: "1px solid var(--stagebook-border, #d1d5db)",
          borderRadius: "0.375rem",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
          fontSize: "0.875rem",
          lineHeight: "1.25rem",
          color: "var(--stagebook-text, #1f2937)",
          resize: "vertical",
        }}
      />
      {renderCharacterCount()}
      <style>{`
        /* Animate a box-shadow glow instead of the text color, so the
           steady-state countColor (gray/green) is preserved throughout
           the pulse — animating color back to "inherit" produced a brief
           flash to the parent color before snapping back to countColor at
           animation end. The warning color is referenced via the same
           --stagebook-warning token used by host theming, so a themed
           orange (etc.) propagates through the pulse. */
        @keyframes stagebook-char-counter-pulse {
          0% {
            box-shadow: 0 0 0 0 var(--stagebook-warning, #dc2626);
          }
          30% {
            box-shadow: 0 0 0 4px var(--stagebook-warning, #dc2626);
          }
          100% {
            box-shadow: 0 0 0 0 var(--stagebook-warning, #dc2626);
          }
        }
      `}</style>
    </div>
  );
}
