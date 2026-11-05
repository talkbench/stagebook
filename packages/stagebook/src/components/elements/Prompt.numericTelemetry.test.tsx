// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Prompt } from "./Prompt.js";
import type { PromptRecord } from "../../utils/buildPromptRecord.js";

let root: Root;
let dom: HTMLDivElement;
const save = vi.fn<(key: string, record: unknown, scope?: string) => void>();

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  dom = document.createElement("div");
  document.body.appendChild(dom);
  root = createRoot(dom);
  save.mockClear();
  act(() =>
    root.render(
      <Prompt
        metadata={{ type: "numericResponse", name: "number" }}
        body="Enter a number"
        responseItems={[]}
        name="number"
        value={undefined}
        save={save}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const input = () => dom.querySelector("input")!;
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
function edit(value: string) {
  act(() => {
    input().focus();
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: value.at(-1), bubbles: true }),
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value.at(-1),
      }),
    );
  });
}
const record = () => save.mock.calls.at(-1)![1] as PromptRecord;
const stats = () =>
  record().debugMessages.filter((message) => message.type === "typingStats");

test("numeric checkpoints replace the current snapshot and blur finalizes it without extra saves", () => {
  edit("1");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(stats()).toEqual([
    expect.objectContaining({
      totalKeystrokes: 1,
      focusCount: 1,
      blurCount: 0,
      focusedDurationMs: 2000,
    }),
  ]);
  const firstRecord = record();
  const firstSerialized = JSON.stringify(firstRecord);

  edit("12");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(2);
  expect(stats()).toEqual([
    expect.objectContaining({
      totalKeystrokes: 2,
      focusCount: 1,
      blurCount: 0,
      focusedDurationMs: 4000,
    }),
  ]);
  expect(JSON.stringify(firstRecord)).toBe(firstSerialized);

  act(() => input().blur());
  expect(save).toHaveBeenCalledTimes(3);
  expect(stats()).toHaveLength(1);
  expect(stats()[0]).toEqual(expect.objectContaining({ blurCount: 1 }));

  act(() => input().focus());
  advance(500);
  act(() => input().blur());
  expect(save).toHaveBeenCalledTimes(4);
  expect(stats()).toHaveLength(2);
  expect(stats()[1]).toEqual(
    expect.objectContaining({
      focusCount: 2,
      blurCount: 2,
      focusedDurationMs: 4500,
    }),
  );
  advance(10000);
  expect(save).toHaveBeenCalledTimes(4);
});

test("blocked drop saves fresh stats and keeps paste history without creating a blur", () => {
  edit("2");
  advance(1000);
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", {
    value: { getData: () => "123" },
  });
  act(() => {
    input().dispatchEvent(drop);
  });
  expect(drop.defaultPrevented).toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
  expect(record().entry).toBe("2");
  expect(record().debugMessages).toEqual([
    expect.objectContaining({ type: "pasteAttempt", length: 3 }),
    expect.objectContaining({
      type: "typingStats",
      totalKeystrokes: 1,
      blurCount: 0,
      focusedDurationMs: 1000,
    }),
  ]);
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("telemetry-only activity and cutoff do not create numeric saves", () => {
  act(() => {
    input().focus();
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    input().dispatchEvent(new Event("copy", { bubbles: true }));
  });
  advance(6000);
  expect(save).not.toHaveBeenCalled();
  edit("3");
  act(() => root.render(null));
  advance(10000);
  expect(save).not.toHaveBeenCalled();
});
