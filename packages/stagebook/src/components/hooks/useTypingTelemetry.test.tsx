// @vitest-environment jsdom
import React, { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useTypingTelemetry } from "./useTypingTelemetry.js";

let root: Root;
let host: HTMLDivElement;
let telemetry: ReturnType<typeof useTypingTelemetry>;

function Harness({ restored }: { restored?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  telemetry = useTypingTelemetry(ref);
  return (
    <textarea
      ref={ref}
      value={restored}
      onChange={() => {}}
      onFocus={telemetry.onFocus}
      onBlur={telemetry.onBlur}
      onKeyDown={telemetry.onKeyDown}
      onClick={telemetry.onClick}
    />
  );
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const field = () => host.querySelector("textarea")!;
const focus = () => {
  act(() => field().focus());
};
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
function key(key: string, options: KeyboardEventInit = {}) {
  act(() => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
    );
  });
}
function event(type: string) {
  act(() => {
    field().dispatchEvent(new Event(type, { bubbles: true }));
  });
}
function edit(
  next: string,
  inputType = "insertText",
  data: string | null = next,
  options: { before?: boolean; isComposing?: boolean } = {},
) {
  act(() => {
    if (options.before !== false) {
      field().dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType,
          data,
          isComposing: options.isComposing,
        }),
      );
    }
    field().value = next;
    field().dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType,
        data,
        isComposing: options.isComposing,
      }),
    );
  });
}
function legacy() {
  const {
    type,
    totalKeystrokes,
    editingKeyCount,
    arrowKeyCount,
    mouseClickCount,
    focusCount,
    blurCount,
    avgInterval,
    stdDev,
    intervalQuantiles,
    firstKeystrokeDelayMs,
    totalTypingTimeMs,
    focusedDurationMs,
  } = telemetry.snapshot();
  return {
    type,
    totalKeystrokes,
    editingKeyCount,
    arrowKeyCount,
    mouseClickCount,
    focusCount,
    blurCount,
    avgInterval,
    stdDev,
    intervalQuantiles,
    firstKeystrokeDelayMs,
    totalTypingTimeMs,
    focusedDurationMs,
  };
}
const emptyLegacy = {
  type: "typingStats",
  totalKeystrokes: 0,
  editingKeyCount: 0,
  arrowKeyCount: 0,
  mouseClickCount: 0,
  focusCount: 1,
  blurCount: 0,
  avgInterval: 0,
  stdDev: 0,
  intervalQuantiles: null,
  firstKeystrokeDelayMs: null,
  totalTypingTimeMs: null,
  focusedDurationMs: 0,
};

test("Android and Process keys contextualize input without changing legacy counts", () => {
  focus();
  key("Unidentified", { keyCode: 229 });
  edit("a", "insertText", null);
  key("Process");
  edit("ab", "insertText", "b");
  expect(telemetry.snapshot()).toMatchObject({
    inputEventCount: 2,
    beforeInputEventCount: 2,
    inputTypeCounts: { insertText: 2 },
    charsInsertedTotal: 2,
    unidentifiedKeyCount: 1,
    processKeyCount: 1,
    inputWithoutKeydownCount: 0,
    inputEventsWithoutData: 1,
  });
  expect(legacy()).toEqual(emptyLegacy);
});

test("composition measures evolving DOM edits and completed start/end pairs", () => {
  focus();
  event("compositionstart");
  key("Unidentified", { keyCode: 229, isComposing: true });
  edit("n", "insertCompositionText", "n", { isComposing: true });
  edit("ni", "insertCompositionText", "ni", { isComposing: true });
  edit("你", "insertCompositionText", "你", { isComposing: true });
  event("compositionend");
  event("compositionend");
  expect(telemetry.snapshot()).toMatchObject({
    inputEventCount: 3,
    compositionCount: 1,
    charsInsertedTotal: 3,
    charsDeletedTotal: 2,
    charsInsertedByInputType: { insertCompositionText: 3 },
  });
  expect(legacy()).toEqual(emptyLegacy);
});

test("Firefox compositionend before input retains the selected replacement range", () => {
  focus();
  edit("abc", "insertText", "abc");
  field().setSelectionRange(0, 3);
  event("compositionstart");
  event("compositionupdate");
  act(() => {
    field().dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertCompositionText",
        data: "abc",
      }),
    );
    field().setSelectionRange(3, 3);
  });
  event("compositionend");
  edit("abc", "insertCompositionText", "abc", { before: false });
  expect(telemetry.snapshot()).toMatchObject({
    compositionCount: 1,
    beforeInputEventCount: 2,
    inputEventCount: 2,
    inputEventsWithoutBeforeInput: 0,
    inputDiffFallbackCount: 0,
    charsInsertedTotal: 6,
    charsDeletedTotal: 3,
  });
  expect(legacy()).toEqual(emptyLegacy);
});

test("native listeners observe input dispatched by a parent layout effect", () => {
  function EarlyInput() {
    useLayoutEffect(() => {
      field().value = "early";
      field().dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "early",
        }),
      );
    }, []);
    return <Harness />;
  }
  act(() => root.render(<EarlyInput />));
  expect(telemetry.snapshot()).toMatchObject({
    inputEventCount: 1,
    inputEventsWithoutBeforeInput: 1,
    charsInsertedTotal: 5,
    firstInputDelayMs: null,
  });
});

test("synthetic bulk input records provenance, timing, and immutable insertion samples", () => {
  focus();
  advance(250);
  edit("x".repeat(25), "insertText", "x".repeat(25), { before: false });
  const snapshot = telemetry.snapshot();
  expect(snapshot).toMatchObject({
    inputEventCount: 1,
    untrustedInputEventCount: 1,
    inputEventsWithoutBeforeInput: 1,
    inputWithoutKeydownCount: 1,
    firstInputDelayMs: 250,
    totalInputTimeMs: null,
    maxSingleInsertionChars: 25,
    largeInsertionCount: 1,
    largeInsertions: [
      {
        timestamp: 1250,
        msSinceFirstFocus: 250,
        msSinceLastFocus: 250,
        msSinceLastKeydown: null,
        chars: 25,
        inputType: "insertText",
        isTrusted: false,
        isComposing: false,
        precededByKeydown: false,
      },
    ],
  });
  advance(100);
  field().setSelectionRange(0, 25);
  edit("y".repeat(30), "insertReplacementText", "y".repeat(30));
  expect(telemetry.snapshot()).toMatchObject({
    totalInputTimeMs: 100,
    largeInsertionCount: 2,
  });
  expect(snapshot.largeInsertions).toHaveLength(1);
  expect(snapshot.inputTypeCounts).toEqual({ insertText: 1 });
  expect(snapshot.charsInsertedByInputType).toEqual({ insertText: 25 });
  expect(legacy()).toEqual({ ...emptyLegacy, focusedDurationMs: 350 });
});

test("selection context measures equal-length and equal-content replacements", () => {
  focus();
  edit("same", "insertText", "same");
  field().setSelectionRange(0, 4);
  edit("diff", "insertReplacementText", "diff");
  field().setSelectionRange(0, 4);
  edit("diff", "insertReplacementText", "diff");
  expect(telemetry.snapshot()).toMatchObject({
    inputEventCount: 3,
    charsInsertedTotal: 12,
    charsDeletedTotal: 8,
    charsInsertedByInputType: { insertText: 4, insertReplacementText: 8 },
    inputDiffFallbackCount: 0,
  });
  expect(legacy()).toEqual(emptyLegacy);
});

test("a non-text input event does not count the selected text as a replacement", () => {
  focus();
  edit("selected", "insertText", "selected");
  field().setSelectionRange(0, 8);
  edit("selected", "formatBold", null);
  expect(telemetry.snapshot()).toMatchObject({
    inputEventCount: 2,
    inputTypeCounts: { insertText: 1, formatBold: 1 },
    charsInsertedTotal: 8,
    charsDeletedTotal: 0,
  });
});

test("a canceled beforeinput cannot supply stale replacement context", () => {
  focus();
  edit("abcd", "insertText", "abcd");
  field().setSelectionRange(0, 4);
  field().addEventListener("beforeinput", (e) => e.preventDefault(), {
    once: true,
  });
  act(() => {
    field().dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertReplacementText",
        data: "nope",
      }),
    );
  });
  edit("abcd", "insertReplacementText", "abcd", { before: false });
  expect(telemetry.snapshot()).toMatchObject({
    beforeInputEventCount: 2,
    inputEventCount: 2,
    charsInsertedTotal: 4,
    charsDeletedTotal: 0,
    inputEventsWithoutBeforeInput: 1,
    inputDiffFallbackCount: 1,
  });
});

test("legacy key, click, focus, and interval statistics are unchanged", () => {
  focus();
  advance(10);
  key("a");
  edit("a", "insertText", "a");
  advance(20);
  key("ArrowLeft", { ctrlKey: true });
  advance(20);
  key("Backspace");
  edit("", "deleteContentBackward", null);
  advance(40);
  key("v", { metaKey: true });
  key("Meta", { metaKey: true });
  event("click");
  event("copy");
  event("cut");
  act(() => field().blur());
  expect(legacy()).toEqual({
    ...emptyLegacy,
    totalKeystrokes: 3,
    editingKeyCount: 1,
    arrowKeyCount: 1,
    mouseClickCount: 1,
    blurCount: 1,
    avgInterval: 40,
    stdDev: 0,
    intervalQuantiles: Array(21).fill(40),
    firstKeystrokeDelayMs: 10,
    totalTypingTimeMs: 80,
    focusedDurationMs: 90,
  });
  expect(telemetry.snapshot()).toMatchObject({
    shortcutKeyCount: 1,
    copyCount: 1,
    cutCount: 1,
  });
});

test("unknown input types and retained large insertions have fixed bounds", () => {
  focus();
  for (let i = 0; i < 20; i++) {
    field().setSelectionRange(0, field().value.length);
    edit(
      String(i).padStart(30, "x"),
      `unknown-${i}`,
      String(i).padStart(30, "x"),
    );
  }
  expect(telemetry.snapshot()).toMatchObject({
    inputTypeCounts: { other: 20 },
    charsInsertedByInputType: { other: 600 },
    largeInsertionCount: 20,
  });
  expect(telemetry.snapshot().largeInsertions).toHaveLength(10);
  expect(
    telemetry
      .snapshot()
      .largeInsertions?.every((sample) => sample.inputType === "other"),
  ).toBe(true);
});

test("restored values and explicit filtered-value rebases are not participant input", () => {
  act(() => root.render(<Harness restored="restored" />));
  expect(telemetry.snapshot().inputEventCount).toBe(0);
  edit("restored!", "insertText", "!", { before: false });
  expect(telemetry.snapshot().charsInsertedTotal).toBe(1);
  field().value = "filtered";
  telemetry.syncValue();
  edit("filtered?", "insertText", "?", { before: false });
  expect(telemetry.snapshot().charsInsertedTotal).toBe(2);
});

test("missing focus is null, and return visits retain first-focus and latest-focus timing", () => {
  edit("a".repeat(20));
  expect(telemetry.snapshot()).toMatchObject({
    firstInputDelayMs: null,
    largeInsertions: [{ msSinceFirstFocus: null, msSinceLastFocus: null }],
  });
  focus();
  advance(100);
  act(() => field().blur());
  advance(100);
  focus();
  advance(60);
  key("Unidentified");
  advance(51);
  field().setSelectionRange(0, 20);
  edit("b".repeat(20));
  expect(telemetry.snapshot().largeInsertions?.[1]).toMatchObject({
    msSinceFirstFocus: 311,
    msSinceLastFocus: 111,
    msSinceLastKeydown: 51,
    precededByKeydown: false,
  });
  expect(telemetry.snapshot().firstInputDelayMs).toBeNull();
});
