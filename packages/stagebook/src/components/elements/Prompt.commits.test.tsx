// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Prompt } from "./Prompt.js";
import { SubmitButton } from "./SubmitButton.js";
import { TextArea } from "../form/TextArea.js";
import type { DebugMessage } from "../../utils/promptTelemetry.js";
import {
  openResponse,
  multipleChoiceSingle,
  multipleChoiceMultiple,
} from "./fixtures/prompts.js";

let root: Root;
let dom: HTMLDivElement;
const save = vi.fn<(key: string, value?: unknown, scope?: string) => void>();
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
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (
  node = (
    <Prompt {...openResponse} value={undefined} name="answer" save={save} />
  ),
) => {
  act(() => {
    root.render(node);
  });
};
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
function edit(value: string) {
  const input = dom.querySelector("textarea")!;
  act(() => {
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function savedValue() {
  return (save.mock.calls.at(-1)?.[1] as { value: string } | undefined)?.value;
}
function savedMessages() {
  return (save.mock.calls.at(-1)![1] as { debugMessages: DebugMessage[] })
    .debugMessages;
}
function paste(text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  act(() => {
    dom.querySelector("textarea")!.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
}

test("one 2s quiet period saves the latest text and cancels the maximum timer", () => {
  render();
  edit("a");
  advance(1500);
  edit("ab");
  advance(1999);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(savedValue()).toBe("ab");
  expect(savedMessages()).toEqual([
    expect.objectContaining({
      type: "typingStats",
      totalKeystrokes: 2,
      focusCount: 1,
      blurCount: 0,
      focusedDurationMs: 3500,
      totalTypingTimeMs: 1500,
    }),
  ]);
  advance(15000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("5s checkpoints run only while edits are pending, without resetting on each edit", () => {
  render();
  for (let batch = 0; batch < 2; batch++) {
    for (let second = 0; second < 5; second++) {
      edit(`${batch}:${second}`);
      advance(999);
      expect(save).toHaveBeenCalledTimes(batch);
      advance(1);
    }
    expect(save).toHaveBeenCalledTimes(batch + 1);
    expect(savedValue()).toBe(`${batch}:4`);
    expect(savedMessages()).toEqual([
      expect.objectContaining({
        type: "typingStats",
        totalKeystrokes: (batch + 1) * 5,
        focusCount: 1,
        blurCount: 0,
        focusedDurationMs: (batch + 1) * 5000,
        totalTypingTimeMs: (batch + 1) * 5000 - 1000,
      }),
    ]);
  }
  advance(20000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("blur saves text and fresh telemetry before submit, with no later timer write", () => {
  const submit = vi.fn();
  render(
    <>
      <Prompt {...openResponse} value={undefined} name="answer" save={save} />
      <SubmitButton name="continue" save={save} onSubmit={submit} />
    </>,
  );
  edit("finished");
  advance(100);
  const button = dom.querySelector("button")!;
  act(() => {
    button.focus();
    button.click();
  });
  expect(save.mock.calls.map(([key]) => key)).toEqual([
    "prompt_answer",
    "submitButton_continue",
  ]);
  expect(save.mock.calls[0][1]).toMatchObject({
    value: "finished",
    debugMessages: [
      expect.objectContaining({
        type: "typingStats",
        totalKeystrokes: 1,
        blurCount: 1,
      }),
    ],
  });
  expect(submit).toHaveBeenCalledOnce();
  advance(10000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("blur still records new focus telemetry after text was checkpointed", () => {
  render();
  edit("answer");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(1);
  act(() => dom.querySelector("textarea")!.blur());
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][1]).toMatchObject({
    value: "answer",
    debugMessages: [expect.objectContaining({ blurCount: 1 })],
  });
  advance(10000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("checkpoints replace the current summary while preserving blur history and paste attempts", () => {
  render();
  edit("first visit");
  advance(100);
  act(() => dom.querySelector("textarea")!.blur());
  expect(save).toHaveBeenCalledTimes(1);
  const firstVisit = structuredClone(savedMessages()[0]);
  expect(firstVisit).toMatchObject({
    type: "typingStats",
    totalKeystrokes: 1,
    focusCount: 1,
    blurCount: 1,
    focusedDurationMs: 100,
  });

  advance(400);
  edit("second visit");
  const firstPasteAt = Date.now();
  paste("first paste");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(2);
  const earlierCheckpoint = savedMessages();
  const earlierCheckpointCopy = structuredClone(earlierCheckpoint);
  expect(
    earlierCheckpoint.filter(({ type }) => type === "typingStats"),
  ).toEqual([
    firstVisit,
    expect.objectContaining({
      totalKeystrokes: 2,
      focusCount: 2,
      blurCount: 1,
      focusedDurationMs: 2100,
    }),
  ]);

  edit("second visit continued");
  const secondPasteAt = Date.now();
  paste("second paste");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(3);
  edit("second visit finished");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(4);
  expect(savedMessages().filter(({ type }) => type === "typingStats")).toEqual([
    firstVisit,
    expect.objectContaining({
      totalKeystrokes: 4,
      focusCount: 2,
      blurCount: 1,
      focusedDurationMs: 6100,
    }),
  ]);
  const expectedPastes = [
    { type: "pasteAttempt", length: 11, timestamp: firstPasteAt },
    { type: "pasteAttempt", length: 12, timestamp: secondPasteAt },
  ];
  expect(savedMessages().filter(({ type }) => type === "pasteAttempt")).toEqual(
    expectedPastes,
  );
  expect(savedMessages()).toHaveLength(4);

  advance(300);
  act(() => dom.querySelector("textarea")!.blur());
  expect(save).toHaveBeenCalledTimes(5);
  expect(savedMessages().filter(({ type }) => type === "typingStats")).toEqual([
    firstVisit,
    expect.objectContaining({
      totalKeystrokes: 4,
      focusCount: 2,
      blurCount: 2,
      focusedDurationMs: 6400,
    }),
  ]);
  expect(savedMessages().filter(({ type }) => type === "pasteAttempt")).toEqual(
    expectedPastes,
  );
  expect(savedMessages()).toHaveLength(4);
  // Updating the current summary must not mutate an already saved record.
  expect(earlierCheckpoint).toEqual(earlierCheckpointCopy);
  advance(10000);
  expect(save).toHaveBeenCalledTimes(5);
});

test("unmount cancels pending work without saving the partial response", () => {
  render();
  edit("unfinished");
  advance(750);
  render(<div>Next stage</div>);
  advance(10000);
  expect(save).not.toHaveBeenCalled();
});

test("cutoff keeps the last checkpoint without flushing later text or telemetry", () => {
  render();
  edit("checkpointed");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(1);
  const checkpoint = structuredClone(savedMessages());
  expect(checkpoint).toEqual([
    expect.objectContaining({ totalKeystrokes: 1, blurCount: 0 }),
  ]);
  edit("unfinished tail");
  paste("unsaved paste");
  advance(100);
  render(<div>Next stage</div>);
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(savedValue()).toBe("checkpointed");
  expect(savedMessages()).toEqual(checkpoint);
});

test("focus and paste without an edit do not schedule a new checkpoint", () => {
  render();
  act(() => dom.querySelector("textarea")!.focus());
  paste("blocked paste");
  advance(10000);
  expect(save).not.toHaveBeenCalled();
  render(<div>Next stage</div>);
  advance(10000);
  expect(save).not.toHaveBeenCalled();
});

for (const pendingText of ["Latest typed response", ""]) {
  test(`drop commits pending ${pendingText === "" ? "deletion" : "text"} and clears its timers`, () => {
    render(
      <Prompt
        {...openResponse}
        value="Saved response"
        name="answer"
        save={save}
      />,
    );
    edit(pendingText);
    advance(1000);
    expect(save).not.toHaveBeenCalled();
    const timestamp = Date.now();
    const droppedText = "Dragged text";
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    // jsdom does not provide DataTransfer or DragEvent constructors.
    Object.defineProperty(drop, "dataTransfer", {
      value: { getData: () => droppedText },
    });
    act(() => {
      dom.querySelector("textarea")!.dispatchEvent(drop);
    });

    expect(drop.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(
      "prompt_answer",
      expect.objectContaining({
        value: pendingText,
        debugMessages: [
          { type: "pasteAttempt", length: droppedText.length, timestamp },
          expect.objectContaining({
            type: "typingStats",
            totalKeystrokes: 1,
            focusCount: 1,
            blurCount: 0,
            focusedDurationMs: 1000,
          }),
        ],
      }),
      "player",
    );
    expect(savedMessages()).toHaveLength(2);
    advance(10000);
    expect(save).toHaveBeenCalledTimes(1);

    // A later edit starts its own commit window after the drop flushed this one.
    edit("Continued typing");
    advance(1999);
    expect(save).toHaveBeenCalledTimes(1);
    advance(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(savedValue()).toBe("Continued typing");
  });
}

test("first-focus checkpoint replaces an unfocused drop summary and keeps paste order", () => {
  render();
  const textarea = dom.querySelector("textarea")!;
  expect(document.activeElement).not.toBe(textarea);
  const dropTimestamp = Date.now();
  const droppedText = "outside text";
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", {
    value: { getData: () => droppedText },
  });
  act(() => {
    textarea.dispatchEvent(drop);
  });
  expect(drop.defaultPrevented).toBe(true);
  expect(document.activeElement).not.toBe(textarea);
  expect(save).toHaveBeenCalledTimes(1);
  const dropAttempt = {
    type: "pasteAttempt",
    length: droppedText.length,
    timestamp: dropTimestamp,
  };
  expect(savedMessages()).toEqual([
    dropAttempt,
    expect.objectContaining({
      type: "typingStats",
      totalKeystrokes: 0,
      focusCount: 0,
      blurCount: 0,
      focusedDurationMs: 0,
    }),
  ]);

  advance(500);
  edit("first typed response");
  const pasteTimestamp = Date.now();
  paste("later paste");
  advance(1999);
  expect(save).toHaveBeenCalledTimes(1);
  advance(1);
  expect(save).toHaveBeenCalledTimes(2);
  expect(savedValue()).toBe("first typed response");
  expect(savedMessages()).toEqual([
    dropAttempt,
    { type: "pasteAttempt", length: 11, timestamp: pasteTimestamp },
    expect.objectContaining({
      type: "typingStats",
      totalKeystrokes: 1,
      focusCount: 1,
      blurCount: 0,
      focusedDurationMs: 2000,
    }),
  ]);
  advance(10000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("pending text uses the latest callback after a harmless rerender", () => {
  render();
  edit("latest");
  advance(1000);
  const nextSave = vi.fn();
  render(
    <Prompt
      {...openResponse}
      value={undefined}
      name="answer"
      save={nextSave}
    />,
  );
  advance(1000);
  expect(save).not.toHaveBeenCalled();
  expect(nextSave).toHaveBeenCalledTimes(1);
  expect(nextSave.mock.calls[0][1]).toMatchObject({ value: "latest" });
});

test("standalone TextArea keeps its configurable quiet period without a provider", () => {
  render(<TextArea debounceDelay={100} onChange={save} />);
  edit("standalone");
  advance(99);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("standalone");
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
});

for (const fixture of [multipleChoiceSingle, multipleChoiceMultiple]) {
  test(`${fixture.metadata.type}/${"select" in fixture.metadata ? fixture.metadata.select : "single"}: choices save in the change event, without a timer`, () => {
    render(<Prompt {...fixture} value={undefined} name="choice" save={save} />);
    const input = dom.querySelector("input")!;
    act(() => input.focus());
    expect(save).not.toHaveBeenCalled();
    act(() => input.click());
    expect(save).toHaveBeenCalledTimes(1);
    advance(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });
}

test("dropdown selection saves immediately without a pending timer", () => {
  render(
    <Prompt
      {...multipleChoiceSingle}
      metadata={{ name: "choice", type: "dropdown", placeholder: "Choose" }}
      value={undefined}
      name="choice"
      save={save}
    />,
  );
  const select = dom.querySelector("select")!;
  act(() => select.focus());
  expect(save).not.toHaveBeenCalled();
  act(() => {
    select.value = "HTML";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(savedValue()).toBe("HTML");
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("blur clears the maximum timer; later edits start a fresh batch", () => {
  render(<TextArea debounceDelay={1000} maxWait={500} onChange={save} />);
  edit("first");
  advance(400);
  act(() => dom.querySelector("textarea")!.blur());
  expect(save).toHaveBeenCalledTimes(1);
  edit("second");
  advance(400);
  expect(save).toHaveBeenCalledTimes(1);
  advance(100);
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith("second");
  advance(10000);
  expect(save).toHaveBeenCalledTimes(2);
});
