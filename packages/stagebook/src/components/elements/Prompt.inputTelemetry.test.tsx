// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Prompt } from "./Prompt.js";
import { openResponse } from "./fixtures/prompts.js";
import type { TypingStats } from "../../utils/promptTelemetry.js";
import type { PromptRecord } from "../../utils/buildPromptRecord.js";

let root: Root;
let dom: HTMLDivElement;
const save = vi.fn<(key: string, record: unknown) => void>();
const record = (index = -1) => save.mock.calls.at(index)![1] as PromptRecord;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  dom = document.createElement("div");
  document.body.appendChild(dom);
  root = createRoot(dom);
  save.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const field = () => dom.querySelector("textarea")!;
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
const stats = () =>
  record()
    .debugMessages.filter((m): m is TypingStats => m.type === "typingStats")
    .at(-1)!;
function render() {
  act(() =>
    root.render(<Prompt {...openResponse} name="answer" save={save} />),
  );
}
function input(value: string, data: string | null, inputType = "insertText") {
  act(() => {
    field().dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data,
        inputType,
      }),
    );
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field(), value);
    field().dispatchEvent(
      new InputEvent("input", { bubbles: true, data, inputType }),
    );
  });
}

test("blocked paste then bulk input saves one immutable snapshot on the existing quiet boundary", () => {
  render();
  act(() => field().focus());
  const pasteAt = Date.now();
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { getData: () => "x".repeat(40) },
  });
  act(() => {
    field().dispatchEvent(paste);
  });
  expect(paste.defaultPrevented).toBe(true);
  advance(100);
  expect(save).not.toHaveBeenCalled();
  input("x".repeat(40), "x".repeat(40));
  advance(1999);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(stats()).toMatchObject({
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
    focusedDurationMs: 2100,
    inputEventCount: 1,
    charsInsertedTotal: 40,
    charsDeletedTotal: 0,
    maxSingleInsertionChars: 40,
    largeInsertionCount: 1,
    untrustedInputEventCount: 1,
    inputWithoutKeydownCount: 1,
    firstInputDelayMs: 100,
    largeInsertions: [
      {
        timestamp: pasteAt + 100,
        chars: 40,
        inputType: "insertText",
        precededByKeydown: false,
      },
    ],
  });
  expect(record(0).debugMessages[0]).toEqual({
    type: "pasteAttempt",
    length: 40,
    timestamp: pasteAt,
  });
  const firstRecord = JSON.stringify(save.mock.calls[0][1]);
  act(() => {
    field().dispatchEvent(new Event("copy", { bubbles: true }));
    field().dispatchEvent(new Event("cut", { bubbles: true }));
  });
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
  act(() => field().blur());
  expect(save).toHaveBeenCalledTimes(2);
  expect(stats()).toMatchObject({ copyCount: 1, cutCount: 1, blurCount: 1 });
  expect(JSON.stringify(save.mock.calls[0][1])).toBe(firstRecord);
  advance(10000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("Android-style input keeps the legacy keystroke count and blur save count", () => {
  render();
  act(() => field().focus());
  advance(250);
  act(() => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Unidentified",
        keyCode: 229,
      }),
    );
  });
  input("hello", null);
  act(() => field().blur());
  expect(save).toHaveBeenCalledTimes(1);
  expect(stats()).toMatchObject({
    totalKeystrokes: 0,
    unidentifiedKeyCount: 1,
    inputEventCount: 1,
    inputWithoutKeydownCount: 0,
    charsInsertedTotal: 5,
    firstInputDelayMs: 250,
  });
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("cutoff still discards pending text and input telemetry without a flush", () => {
  render();
  act(() => field().focus());
  input("pending", "pending");
  advance(1000);
  act(() => root.render(<div>next stage</div>));
  advance(10000);
  expect(save).not.toHaveBeenCalled();
});
