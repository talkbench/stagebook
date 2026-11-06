// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Prompt, type PromptProps } from "./Prompt.js";
import type { PromptRecord } from "../../utils/buildPromptRecord.js";

let root: Root;
let dom: HTMLDivElement;
let monotonic: number;
let stageTime: number;
const save = vi.fn<(key: string, record: unknown) => void>();
const field = () =>
  dom.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!;
const record = () => save.mock.calls.at(-1)![1] as PromptRecord;
const focus = () => act(() => field().focus());
const blur = () => act(() => field().blur());
const advance = (ms: number) =>
  act(() => {
    monotonic += ms;
    vi.advanceTimersByTime(ms);
  });
function render(
  type: "openResponse" | "numericResponse",
  props: Partial<PromptProps> = {},
) {
  act(() =>
    root.render(
      <Prompt
        metadata={{ type, name: "answer" }}
        body="Question"
        responseItems={[]}
        name="answer"
        value={undefined}
        save={save}
        getElapsedTime={() => stageTime}
        step="first"
        {...props}
      />,
    ),
  );
}
function edit(value: string) {
  const input = field();
  act(() => {
    Object.getOwnPropertyDescriptor(
      input.tagName === "INPUT"
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value.at(-1),
      }),
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  monotonic = 1000;
  stageTime = 20;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  dom = document.createElement("div");
  document.body.appendChild(dom);
  root = createRoot(dom);
  save.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each(["openResponse", "numericResponse"] as const)(
  "%s saves first focus on existing quiet/blur commits, independently of save time",
  (type) => {
    render(type);
    advance(1250);
    stageTime = 21.25;
    focus();
    expect(save).not.toHaveBeenCalled();
    edit("1");
    stageTime = 30;
    advance(1999);
    expect(save).not.toHaveBeenCalled();
    advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(record()).toMatchObject({
      stageTimeElapsed: 30,
      fieldTiming: {
        version: 1,
        firstFocusDelayMs: 1250,
        firstFocusStageTimeElapsed: 21.25,
      },
    });
    const saved = record();
    const original = JSON.stringify(saved);
    blur();
    expect(save).toHaveBeenCalledTimes(2);
    advance(1000);
    stageTime = 90;
    focus();
    edit("12");
    blur();
    expect(save).toHaveBeenCalledTimes(3);
    expect(record().fieldTiming).toEqual(saved.fieldTiming);
    expect(record().fieldTiming).not.toBe(saved.fieldTiming);
    expect(JSON.stringify(saved)).toBe(original);
    advance(10000);
    expect(save).toHaveBeenCalledTimes(3);
  },
);

test.each(["openResponse", "numericResponse"] as const)(
  "%s max-wait checkpoint includes timing without extra saves at cutoff",
  (type) => {
    render(type);
    advance(500);
    focus();
    for (const value of ["1", "12", "123", "1234", "12345"]) {
      edit(value);
      advance(1000);
    }
    expect(save).toHaveBeenCalledTimes(1);
    expect(record().fieldTiming?.firstFocusDelayMs).toBe(500);
    edit("123456");
    act(() => root.render(null));
    advance(10000);
    expect(save).toHaveBeenCalledTimes(1);
  },
);

test.each(["openResponse", "numericResponse"] as const)(
  "%s restored value and unfocused drop do not invent a focus",
  (type) => {
    render(type, { value: "7", entry: "7" });
    expect(save).not.toHaveBeenCalled();
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { getData: () => "blocked" },
    });
    act(() => {
      field().dispatchEvent(event);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(record().fieldTiming).toEqual({
      version: 1,
      firstFocusDelayMs: null,
      firstFocusStageTimeElapsed: null,
    });
  },
);

test.each(["openResponse", "numericResponse"] as const)(
  "%s resets timing for a delayed remount or a new stage with the same name",
  (type) => {
    render(type);
    advance(100);
    focus();
    blur();
    expect(record().fieldTiming?.firstFocusDelayMs).toBe(100);
    act(() => root.render(null));
    advance(20000);
    render(type);
    advance(250);
    focus();
    blur();
    expect(record().fieldTiming?.firstFocusDelayMs).toBe(250);
    stageTime = 0;
    render(type, { step: "next" });
    advance(1000);
    stageTime = 1;
    focus();
    blur();
    expect(record()).toMatchObject({
      step: "next",
      fieldTiming: { firstFocusDelayMs: 1000, firstFocusStageTimeElapsed: 1 },
    });
  },
);

test("focus followed by cutoff creates no save", () => {
  render("openResponse");
  advance(500);
  focus();
  advance(10000);
  act(() => root.render(null));
  advance(10000);
  expect(save).not.toHaveBeenCalled();
});

test.each(["openResponse", "numericResponse"] as const)(
  "%s resets for a new stage ID even when the progress label is reused",
  (type) => {
    render(type, { stageId: "stage-a" });
    advance(100);
    focus();
    blur();
    render(type, { stageId: "stage-b" });
    advance(500);
    stageTime = 0.5;
    focus();
    blur();
    expect(record()).toMatchObject({
      step: "first",
      fieldTiming: { firstFocusDelayMs: 500, firstFocusStageTimeElapsed: 0.5 },
    });
  },
);
