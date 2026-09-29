import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMessages, useIsRTL } from "../StagebookProvider.js";
import { useResponseCommit } from "../hooks/useResponseCommit.js";
import { useTypingTelemetry } from "../hooks/useTypingTelemetry.js";
import { focusRingCss } from "../focusRing.js";
import { TEXTAREA_FONT_FAMILY, TEXTAREA_METRICS } from "./TextArea.js";
import {
  filterNumericInsertion,
  numericInputMode,
  type NumericConstraints,
} from "../../utils/numericResponse.js";
import { getNumericFeedback } from "../../utils/numericFeedback.js";
import type { NumberFormat } from "../../messages/types.js";
import type { DebugMessage } from "../../utils/promptTelemetry.js";

export interface NumericInputProps {
  /** Raw restored text; omission means the participant has not answered. */
  entry?: string;
  /** Format saved with a restored answer. It stays until an accepted edit. */
  numberFormat?: NumberFormat;
  /** Format to adopt at the next accepted edit; defaults to the active catalog. */
  nextEditNumberFormat?: NumberFormat;
  constraints?: NumericConstraints;
  prefix?: string;
  suffix?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaRequired?: boolean;
  id?: string;
  onChange?: (entry: string, numberFormat: NumberFormat) => void;
  onDebugMessage?: (message: DebugMessage) => void;
  debounceDelay?: number;
  maxWait?: number;
}

interface Selection {
  start: number;
  end: number;
}
interface Snapshot extends Selection {
  entry: string;
}
interface Response {
  entry: string;
  numberFormat: NumberFormat;
}

/** Recover an insertion when an input source supplies no usable beforeinput data. */
function changedRange(previous: string, next: string) {
  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  )
    start++;
  let end = previous.length;
  let nextEnd = next.length;
  while (
    end > start &&
    nextEnd > start &&
    previous[end - 1] === next[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  return { start, end, inserted: next.slice(start, nextEnd) };
}

export function NumericInput({
  entry,
  numberFormat,
  nextEditNumberFormat,
  constraints = {},
  prefix,
  suffix,
  ariaLabel,
  ariaLabelledBy,
  ariaRequired,
  id,
  onChange,
  onDebugMessage,
  debounceDelay = 2000,
  maxWait = 5000,
}: NumericInputProps) {
  const messages = useMessages();
  const isRTL = useIsRTL();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const prefixId = `${generatedId}-prefix`;
  const suffixId = `${generatedId}-suffix`;
  const feedbackId = `${generatedId}-feedback`;
  const groupClass = `stagebook-number-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [localEntry, setLocalEntry] = useState(entry ?? "");
  const stableEntry = useRef(entry ?? "");
  const [displayFormat, setDisplayFormat] = useState(
    numberFormat ?? messages.numberFormat,
  );
  const effectiveFormat = useRef(displayFormat);
  const [revealProblems, setRevealProblems] = useState(entry !== undefined);
  const [pulse, setPulse] = useState(0);
  const [isPulsing, setIsPulsing] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [reducedMotion, setReducedMotion] = useState(false);
  const selection = useRef<Selection | undefined>(undefined);
  const before = useRef<Snapshot | undefined>(undefined);
  const composition = useRef<Snapshot | undefined>(undefined);
  const finishedComposition = useRef<
    { raw: string; entry: string; selection: Selection } | undefined
  >(undefined);
  const telemetry = useTypingTelemetry();
  const commits = useResponseCommit<Response>({
    onCommit: (response) => onChange?.(response.entry, response.numberFormat),
    debounceDelay,
    maxWait,
  });

  useEffect(() => {
    if (!commits.hasPending() && !composition.current) {
      const restored = entry ?? "";
      if (restored !== stableEntry.current)
        setRevealProblems(entry !== undefined);
      stableEntry.current = restored;
      setLocalEntry(restored);
      effectiveFormat.current = numberFormat ?? messages.numberFormat;
      setDisplayFormat(effectiveFormat.current);
    }
    // Catalog changes are adopted on an edit, never by silently reparsing a restore.
  }, [entry, numberFormat?.decimal, numberFormat?.grouping]);

  useLayoutEffect(() => {
    if (selection.current && inputRef.current) {
      inputRef.current.setSelectionRange(
        selection.current.start,
        selection.current.end,
      );
      selection.current = undefined;
    }
  });

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    setReducedMotion(media.matches);
    const change = (event: MediaQueryListEvent) =>
      setReducedMotion(event.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(
    () => () => {
      if (pulseTimer.current !== undefined) clearTimeout(pulseTimer.current);
    },
    [],
  );

  const refuse = () => {
    if (pulseTimer.current !== undefined) clearTimeout(pulseTimer.current);
    setPulse((previous) => previous + 1);
    setIsPulsing(true);
    pulseTimer.current = setTimeout(() => setIsPulsing(false), 300);
  };
  const display = (text: string, nextSelection: Selection) => {
    setLocalEntry(text);
    selection.current = nextSelection;
    // Restore immediately too: a wholly refused edit may leave React state unchanged.
    if (inputRef.current) {
      inputRef.current.value = text;
      inputRef.current.setSelectionRange(
        nextSelection.start,
        nextSelection.end,
      );
    }
  };
  const applyInsertion = (snapshot: Snapshot, inserted: string) => {
    const editFormat = nextEditNumberFormat ?? messages.numberFormat;
    const result = filterNumericInsertion(
      { ...snapshot, inserted },
      editFormat,
    );
    const nextSelection = {
      start: result.selectionStart,
      end: result.selectionEnd,
    };
    display(result.entry, nextSelection);
    if (result.refused) refuse();
    if (result.accepted) {
      stableEntry.current = result.entry;
      effectiveFormat.current = editFormat;
      setDisplayFormat(editFormat);
      setRevealProblems(false);
      commits.queue({ entry: result.entry, numberFormat: editFormat });
    }
    return { entry: result.entry, selection: nextSelection };
  };
  const insertionRef = useRef(applyInsertion);
  insertionRef.current = applyInsertion;

  useEffect(() => {
    const input = inputRef.current!;
    const onBeforeInput = (event: InputEvent) => {
      if (composition.current || event.isComposing) return;
      if (
        finishedComposition.current &&
        event.inputType.includes("Composition")
      ) {
        event.preventDefault();
        return;
      }
      finishedComposition.current = undefined;
      before.current = {
        entry: stableEntry.current,
        start: input.selectionStart ?? 0,
        end: input.selectionEnd ?? 0,
      };
      // Some autofill/dictation events cannot be canceled. Filter their
      // resulting input instead, so the browser doesn't apply insertion twice.
      if (!event.cancelable) return;
      if (
        event.inputType === "insertLineBreak" ||
        event.inputType === "insertParagraph"
      ) {
        event.preventDefault();
      } else if (event.inputType.startsWith("insert") && event.data !== null) {
        event.preventDefault();
        insertionRef.current(before.current, event.data);
        before.current = undefined;
      }
    };
    input.addEventListener("beforeinput", onBeforeInput);
    return () => input.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (composition.current || (event.nativeEvent as InputEvent).isComposing) {
      setLocalEntry(next);
      return;
    }
    const finished = finishedComposition.current;
    if (finished && (next === finished.raw || next === finished.entry)) {
      display(finished.entry, finished.selection);
      finishedComposition.current = undefined;
      return;
    }
    const previous = stableEntry.current;
    let change = changedRange(previous, next);
    const snapshot = before.current;
    if (
      snapshot?.entry === previous &&
      next.startsWith(previous.slice(0, snapshot.start)) &&
      next.endsWith(previous.slice(snapshot.end)) &&
      next.length >= snapshot.start + previous.length - snapshot.end
    ) {
      change = {
        start: snapshot.start,
        end: snapshot.end,
        inserted: next.slice(
          snapshot.start,
          next.length - (previous.length - snapshot.end),
        ),
      };
    }
    before.current = undefined;
    applyInsertion(
      { entry: previous, start: change.start, end: change.end },
      change.inserted,
    );
  };
  const finishComposition = (data?: string) => {
    const snapshot = composition.current;
    if (!snapshot) return;
    const raw = inputRef.current?.value ?? localEntry;
    composition.current = undefined;
    // An IME cancellation restores the pre-composition value. It is not a
    // deletion of the selection the composition originally replaced.
    if (data === "" && raw === snapshot.entry) {
      const originalSelection = { start: snapshot.start, end: snapshot.end };
      display(snapshot.entry, originalSelection);
      finishedComposition.current = {
        raw,
        entry: snapshot.entry,
        selection: originalSelection,
      };
      return;
    }
    const inserted =
      data ??
      raw.slice(
        snapshot.start,
        raw.length - (snapshot.entry.length - snapshot.end),
      );
    const result = applyInsertion(snapshot, inserted);
    finishedComposition.current = { ...result, raw };
  };
  const snapshotResponse = (): Response => ({
    entry: stableEntry.current,
    numberFormat: effectiveFormat.current,
  });
  const pasteAttempt = (text: string) =>
    onDebugMessage?.({
      type: "pasteAttempt",
      length: text.length,
      timestamp: Date.now(),
    });
  const handleBlur = () => {
    finishComposition();
    commits.cancel();
    const stats = telemetry.onBlur();
    onDebugMessage?.(stats);
    setRevealProblems(true);
    commits.commit(snapshotResponse());
  };
  const feedback = getNumericFeedback(
    stableEntry.current,
    constraints,
    displayFormat,
    revealProblems,
    messages,
  );
  const color =
    feedback.state === "valid"
      ? "var(--stagebook-success, #15803d)"
      : feedback.state === "problem"
        ? "var(--stagebook-warning, #b45309)"
        : "var(--stagebook-text-muted, #626977)";
  const affixStyle: React.CSSProperties = {
    minWidth: 0,
    flex: "0 1 auto",
    overflowWrap: "anywhere",
    color: "var(--stagebook-text-muted, #626977)",
  };

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      style={{ width: "100%", boxSizing: "border-box" }}
    >
      <div
        className={groupClass}
        data-testid="numeric-field"
        onClick={() => inputRef.current?.focus()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          boxSizing: "border-box",
          borderWidth: TEXTAREA_METRICS.borderWidthPx,
          borderStyle: "solid",
          borderColor: "var(--stagebook-border, #d1d5db)",
          borderRadius: `${TEXTAREA_METRICS.borderRadiusRem}rem`,
          padding: `${TEXTAREA_METRICS.paddingBlockRem}rem ${TEXTAREA_METRICS.paddingInlineRem}rem`,
          fontFamily: TEXTAREA_FONT_FAMILY,
          fontSize: `${TEXTAREA_METRICS.fontSizeRem}rem`,
          lineHeight: `${TEXTAREA_METRICS.lineHeightRem}rem`,
          backgroundColor: "var(--stagebook-surface, #fff)",
        }}
      >
        {prefix && (
          <bdi id={prefixId} style={affixStyle}>
            {prefix}
          </bdi>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          dir="ltr"
          autoComplete="off"
          inputMode={numericInputMode(constraints)}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-required={ariaRequired ?? (constraints.required || undefined)}
          aria-describedby={[
            prefix ? prefixId : undefined,
            suffix ? suffixId : undefined,
            feedbackId,
          ]
            .filter(Boolean)
            .join(" ")}
          value={localEntry}
          onChange={handleChange}
          onFocus={telemetry.onFocus}
          onBlur={handleBlur}
          onClick={telemetry.onClick}
          onKeyDown={(event) => {
            finishedComposition.current = undefined;
            telemetry.onKeyDown(event);
            if (event.key === "Enter") event.preventDefault();
          }}
          onCompositionStart={() => {
            composition.current = {
              entry: stableEntry.current,
              start: inputRef.current?.selectionStart ?? 0,
              end: inputRef.current?.selectionEnd ?? 0,
            };
          }}
          onCompositionEnd={(event) => finishComposition(event.data)}
          onPaste={(event) => {
            event.preventDefault();
            pasteAttempt(event.clipboardData.getData("text"));
          }}
          onDrop={(event) => {
            event.preventDefault();
            commits.cancel();
            pasteAttempt(event.dataTransfer.getData("text"));
            commits.commit(snapshotResponse());
          }}
          style={{
            colorScheme: "light",
            flex: "1 0 6rem",
            minWidth: "6rem",
            width: "6rem",
            padding: 0,
            margin: 0,
            border: 0,
            // The group paints the ordinary indicator. Keep the native
            // focus outline available for forced-colors to repaint too.
            outlineColor: "transparent",
            boxShadow: "none",
            borderRadius: 0,
            background: "transparent",
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: "inherit",
            color: "var(--stagebook-text, #1f2937)",
            textAlign: isRTL ? "right" : "left",
          }}
        />
        {suffix && (
          <bdi id={suffixId} style={affixStyle}>
            {suffix}
          </bdi>
        )}
      </div>
      <div
        id={feedbackId}
        key={isPulsing ? `pulse-${pulse}` : "steady"}
        data-testid="numeric-feedback"
        data-state={feedback.state}
        data-pulsing={isPulsing ? "true" : "false"}
        style={{
          textAlign: "end",
          fontSize: "0.75rem",
          marginTop: "0.25rem",
          paddingInlineEnd: "0.75rem",
          color,
          boxSizing: "border-box",
          width: "100%",
          ...(isPulsing
            ? reducedMotion
              ? { boxShadow: "0 0 0 4px var(--stagebook-warning, #b45309)" }
              : { animation: "stagebook-numeric-pulse 300ms ease-out" }
            : {}),
        }}
      >
        {feedback.text}
      </div>
      <style>{`
      .${groupClass} { box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); transition: box-shadow 120ms ease-out; }
      .${groupClass}:has(input:focus-visible) { ${focusRingCss("0 1px 2px 0 rgba(0,0,0,0.05)")} }
      @keyframes stagebook-numeric-pulse { 0%,100% { box-shadow: 0 0 0 0 var(--stagebook-warning, #b45309); } 30% { box-shadow: 0 0 0 4px var(--stagebook-warning, #b45309); } }
      @media (prefers-reduced-motion: reduce) { .${groupClass} { transition: none; } }
    `}</style>
    </div>
  );
}
