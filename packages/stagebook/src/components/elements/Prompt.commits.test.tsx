// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Prompt } from "./Prompt.js";
import { SubmitButton } from "./SubmitButton.js";
import { TextArea } from "../form/TextArea.js";
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

test("unmount cancels pending work without saving the partial response", () => {
  render();
  edit("unfinished");
  advance(750);
  render(<div>Next stage</div>);
  advance(10000);
  expect(save).not.toHaveBeenCalled();
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
