import React, { useEffect, useState, useRef, useId } from "react";
import { useResponseCommit } from "../hooks/useResponseCommit.js";
import { checkResponse } from "../../utils/checkResponse.js";
import { useTypingTelemetry } from "../hooks/useTypingTelemetry.js";
import { useMessages, useIsRTL } from "../StagebookProvider.js";
import { focusRingCss } from "../focusRing.js";

import type { DebugMessage } from "../../utils/promptTelemetry.js";

// Preserve the existing component entry point for host type imports.
export type {
  TypingStats,
  PasteAttempt,
  DebugMessage,
} from "../../utils/promptTelemetry.js";

export interface TextAreaProps {
  defaultText?: string;
  onChange?: (value: string) => void;
  onDebugMessage?: (message: DebugMessage) => void;
  value?: string;
  rows?: number;
  showCharacterCount?: boolean;
  minLength?: number;
  maxLength?: number;
  /** Quiet period before emitting the latest edit. */
  debounceDelay?: number;
  /** Maximum age of a pending batch; idle fields never start this timer. */
  maxWait?: number;
  id?: string;
  // Accessible-name affordances for standalone use (#538). Inside a
  // Prompt the surrounding markup names the field, but TextArea is a
  // public export (`stagebook/components`) that hosts drop in on their
  // own — a bare <textarea> carries only an `id`, so without one of
  // these it has no programmatic accessible name (WCAG 1.3.1 / 4.1.2).
  // Mirrors the `label` prop on RadioGroup / CheckboxGroup / Select.
  //
  // `label` renders a visible <label htmlFor={id}>. `ariaLabel` /
  // `ariaLabelledBy` pass through to the textarea for the invisible-
  // label / external-element cases. If more than one is supplied the
  // accessible-name spec resolves it deterministically
  // (aria-labelledby > aria-label > <label for>).
  label?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Advisory required state; does not enable native form validation. */
  ariaRequired?: boolean;
}

/**
 * Box metrics of the rendered `<textarea>`. Exported so that stand-in
 * renderers — the viewer's shared-notepad placeholder (#591) — can reproduce
 * this component's typography instead of hardcoding a second copy of the
 * numbers that silently drifts when these change. The styles below are built
 * from these values, so there is exactly one source of truth.
 *
 * The runner's collaborative editor pins its CodeMirror theme to these same
 * values on purpose, so that a shared and a solo response field are
 * typographically identical. Changing them here changes both.
 */
export const TEXTAREA_FONT_FAMILY =
  'var(--stagebook-font, "Inter", ui-sans-serif, system-ui, sans-serif)';

export const TEXTAREA_METRICS = {
  fontSizeRem: 0.875,
  lineHeightRem: 1.25,
  paddingBlockRem: 0.5,
  paddingInlineRem: 0.75,
  borderWidthPx: 1,
  borderRadiusRem: 0.375,
} as const;

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
  maxWait = 5000,
  id,
  label = "",
  ariaLabel,
  ariaLabelledBy,
  ariaRequired,
}: TextAreaProps) {
  const messages = useMessages();
  const isRTL = useIsRTL();
  const generatedId = useId();
  const textAreaId = id || generatedId;
  // `useId` returns an opaque string the React docs call "not a valid
  // HTML id/class on its own". Strip anything outside the class-name-
  // safe set so the regex doesn't drift if React's format changes.
  const safeId = generatedId.replace(/[^a-zA-Z0-9_-]/g, "");
  const textareaClass = `stagebook-textarea-${safeId}`;
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
  const responseCommit = useResponseCommit({
    onCommit: onChange,
    debounceDelay,
    maxWait,
  });
  const { hasPending } = responseCommit;
  const overflowTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const telemetry = useTypingTelemetry();

  // Sync with external value only when not actively debouncing
  useEffect(() => {
    if (!hasPending()) {
      setLocalValue(value || "");
    }
  }, [value, hasPending]);

  // The commit hook cancels unsaved responses on unmount. Also clear the
  // transient overflow feedback timer.
  useEffect(() => {
    return () => {
      if (overflowTimeout.current) clearTimeout(overflowTimeout.current);
    };
  }, []);

  // Listen to `prefers-reduced-motion` so the overflow signal can swap
  // its animated pulse for a static red glow. The inline `animation`
  // style applied while overflowing wins specificity over any CSS
  // media query, so we need to switch in JS rather than purely in CSS.
  // SSR-safe: matches `false` server-side; hydrates to the real value
  // on the first useEffect tick.
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const recordPasteAttempt = (text: string) => {
    if (onDebugMessage) {
      onDebugMessage({
        type: "pasteAttempt",
        length: text.length,
        timestamp: Date.now(),
      });
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    recordPasteAttempt(e.clipboardData.getData("text"));
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    // Dragged text bypasses typing just like paste; keep the same telemetry.
    e.preventDefault();
    const latest = responseCommit.peek() ?? localValue;
    responseCommit.cancel();
    recordPasteAttempt(e.dataTransfer.getData("text"));
    // A canceled drop need not focus the field, so there may be no later blur
    // or edit. Commit the unchanged text now to save the attempt in Prompt.
    responseCommit.commit(latest);
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
    responseCommit.queue(newValue);
  };

  const handleBlur = () => {
    const latest = responseCommit.peek() ?? localValue;
    responseCommit.cancel();
    // Prompt saves synchronously now. Deliver telemetry first, including
    // focus-only visits after a checkpoint where the text did not change.
    const stats = telemetry.onBlur();
    onDebugMessage?.(stats);
    responseCommit.commit(latest);
  };

  const renderCharacterCount = () => {
    if (!showCharacterCount) return null;

    let countText = "";
    let countColor = "var(--stagebook-text-muted, #626977)";
    let countState = "default";
    // Count UTF-16 code units (String.length) ON PURPOSE — do NOT "fix" this to
    // grapheme clusters via Intl.Segmenter. Stagebook is a measurement
    // instrument: the same version must count the same text identically across
    // every browser, but Segmenter's grapheme boundaries are ICU-version-
    // dependent, so it would make participants on different engines see
    // different lengths and hit the maxLength cap at different points. Code
    // units are deterministic everywhere. (Common CJK logographs are BMP, so
    // they already count as 1; only supplementary-plane chars — emoji, rare
    // ideographs — count as 2, and combining sequences over-count. If that edge
    // ever matters, move to code points via [...str].length, which is also
    // deterministic — never to grapheme segmentation.) The maxLength typing cap
    // in handleChange uses this same measure, so the counter and the limit can
    // never disagree.
    const currentLength = localValue.length;
    const validity = checkResponse(localValue, { minLength, maxLength });

    if (minLength && maxLength) {
      countText = messages.charCount(currentLength, minLength, maxLength);
      // The valid range is [minLength, maxLength] inclusive on both ends.
      // Hitting maxLength is "you're at the upper limit" — a fact, not an
      // error. Attempts to type past it pulse red via isOverflowing (#333).
      if (!validity.blank && validity.isValid) {
        countColor = "var(--stagebook-success, #15803d)";
        countState = "valid";
      }
    } else if (minLength) {
      countText = messages.charCount(currentLength, minLength);
      if (!validity.blank && validity.isValid) {
        countColor = "var(--stagebook-success, #15803d)";
        countState = "valid";
      }
    } else if (maxLength) {
      countText = messages.charCount(currentLength, undefined, maxLength);
    } else {
      countText = messages.charCount(currentLength);
    }

    // Pulse animation takes priority over the steady-state color — when the
    // participant tries to type past maxLength, the counter flashes red for
    // 300ms regardless of the underlying valid state. For participants who
    // prefer reduced motion we drop the pulse animation but keep the signal
    // visible as a static red glow for the same 300ms window — the React
    // `key` on the wrapper div still re-mounts the element so the glow
    // reliably re-appears on every overflow attempt.
    const animationStyle = !isOverflowing
      ? {}
      : prefersReducedMotion
        ? { boxShadow: "0 0 0 4px var(--stagebook-warning, #b45309)" }
        : { animation: "stagebook-char-counter-pulse 300ms ease-out" };
    const overflowState = isOverflowing ? "overflow" : countState;

    return (
      <div
        key={isOverflowing ? `pulse-${overflowPulseId}` : "steady"}
        data-testid="char-counter"
        data-state={overflowState}
        style={{
          textAlign: "end",
          fontSize: "0.75rem",
          marginTop: "0.25rem",
          paddingInlineEnd: "0.75rem",
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
      dir={isRTL ? "rtl" : "ltr"}
      style={{ position: "relative", width: "100%", boxSizing: "border-box" }}
    >
      {label && (
        // Visible label, associated via htmlFor. Styling matches the
        // `label` on Select / RadioGroup / CheckboxGroup so a host mixing
        // form components gets a consistent look (#538).
        <label
          htmlFor={textAreaId}
          style={{
            display: "block",
            fontSize: "1rem",
            fontWeight: 500,
            color: "var(--stagebook-text, #1f2937)",
            marginBottom: "0.5rem",
          }}
        >
          {label}
        </label>
      )}
      <textarea
        id={textAreaId}
        className={textareaClass}
        // Pass-throughs for the invisible-label / external-element cases.
        // Undefined renders no attribute, so the Prompt-wrapped path is
        // unchanged; when a visible `label` is used its htmlFor link
        // supplies the name and these stay absent (#538).
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-required={ariaRequired}
        autoComplete="off"
        rows={rows}
        placeholder={defaultText}
        value={localValue}
        onChange={handleChange}
        onFocus={telemetry.onFocus}
        onBlur={handleBlur}
        onClick={telemetry.onClick}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onKeyDown={telemetry.onKeyDown}
        style={{
          // Keep the native surface and scrollbar light under host/OS themes.
          colorScheme: "light",
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          padding: `${TEXTAREA_METRICS.paddingBlockRem}rem ${TEXTAREA_METRICS.paddingInlineRem}rem`,
          // Border longhands rather than the `border` shorthand —
          // matches the pattern adopted in #367 (RadioGroup) and the
          // sibling form components. Lets future state-based color
          // overrides on `borderColor` (e.g. an error state) play
          // nicely with React's inline-style diff.
          borderWidth: `${TEXTAREA_METRICS.borderWidthPx}px`,
          borderStyle: "solid",
          borderColor: "var(--stagebook-border, #d1d5db)",
          borderRadius: `${TEXTAREA_METRICS.borderRadiusRem}rem`,
          // Pin the font so it doesn't pick up the browser UA default
          // for <textarea> — Chrome resolves that to a monospace
          // stack, Safari to sans-serif, so the same TextArea would
          // otherwise render different fonts cross-browser (#399).
          // Hosts override --stagebook-font at :root to opt out.
          fontFamily: TEXTAREA_FONT_FAMILY,
          fontSize: `${TEXTAREA_METRICS.fontSizeRem}rem`,
          lineHeight: `${TEXTAREA_METRICS.lineHeightRem}rem`,
          color: "var(--stagebook-text, #1f2937)",
          resize: "vertical",
          // Note on `box-shadow` and `transition`: both kept in the
          // class-scoped <style> block (not inline). The `:focus-visible`
          // rule stacks the focus ring on top of the elevation shadow,
          // and the prefers-reduced-motion rule turns the transition
          // off — an inline declaration would outrank either (#630).
        }}
      />
      {renderCharacterCount()}
      <style>{`
        /* Base subtle elevation, kept in CSS so the :focus-visible
           rule below can layer the focus ring on top without
           losing to an inline-style boxShadow on specificity. */
        .${textareaClass} {
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          transition: box-shadow 120ms ease-out;
        }
        /* Focus ring on the textarea — uses :focus-visible (not
           :focus). Browsers apply :focus-visible to text inputs even
           on mouse click because text fields are always
           keyboard-active. The ring matches the pattern used by the
           sibling form components (Radio / Checkbox / Select). The
           trailing 1px shadow preserves the textarea subtle elevation
           under the ring. */
        .${textareaClass}:focus-visible {
          ${focusRingCss("0 1px 2px 0 rgba(0, 0, 0, 0.05)")}
        }

        /* Animate a box-shadow glow instead of the text color, so the
           steady-state countColor (gray/green) is preserved throughout
           the pulse — animating color back to "inherit" produced a brief
           flash to the parent color before snapping back to countColor at
           animation end. The warning color is referenced via the same
           --stagebook-warning token used by host theming, so a themed
           orange (etc.) propagates through the pulse. */
        @keyframes stagebook-char-counter-pulse {
          0% {
            box-shadow: 0 0 0 0 var(--stagebook-warning, #b45309);
          }
          30% {
            box-shadow: 0 0 0 4px var(--stagebook-warning, #b45309);
          }
          100% {
            box-shadow: 0 0 0 0 var(--stagebook-warning, #b45309);
          }
        }

        /* Respect prefers-reduced-motion for the focus-ring
           transition. (The char-counter overflow signal is handled
           in JS via the prefersReducedMotion state — the inline
           animation style applied while overflowing wins specificity
           over any class-scoped CSS rule, so JS is the cleaner
           path.) */
        @media (prefers-reduced-motion: reduce) {
          .${textareaClass} {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
