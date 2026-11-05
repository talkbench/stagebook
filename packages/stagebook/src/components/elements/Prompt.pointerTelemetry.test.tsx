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
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const record = () => save.mock.calls.at(-1)![1] as PromptRecord;

test.each(["openResponse", "numericResponse"] as const)(
  "%s captures focus/click activity on existing blur saves only",
  (type) => {
    act(() =>
      root.render(
        <Prompt
          metadata={{ type }}
          body="Question"
          responseItems={[]}
          name="answer"
          value={undefined}
          save={save}
        />,
      ),
    );
    const field = dom.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "textarea, input",
    )!;
    act(() => {
      field.focus();
      field.click();
      vi.advanceTimersByTime(10000);
    });
    expect(save).not.toHaveBeenCalled();
    act(() => field.blur());
    expect(save).toHaveBeenCalledTimes(1);
    expect(record().pointerStats).toMatchObject({
      clickCount: 1,
      clickCountsBySource: { pointer: 0, keyboard: 0, unknown: 1 },
      clickSamples: [{ source: "unknown", position: null }],
      focusCount: 1,
      focusSamples: [{ source: "unknown", visit: "first", position: null }],
    });
    expect(record().debugMessages).toEqual([
      expect.objectContaining({
        type: "typingStats",
        mouseClickCount: 1,
        focusCount: 1,
        blurCount: 1,
      }),
    ]);
    const first = record();
    const serialized = JSON.stringify(first);
    act(() => {
      field.focus();
      field.click();
      field.blur();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(record().pointerStats).toMatchObject({
      clickCount: 2,
      focusCount: 2,
    });
    expect(record().pointerStats?.focusSamples[1].visit).toBe("return");
    expect(JSON.stringify(first)).toBe(serialized);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(save).toHaveBeenCalledTimes(2);
  },
);

test.each(["single", "multiple"] as const)(
  "%s choice includes the current activation in its one existing save",
  (select) => {
    act(() =>
      root.render(
        <Prompt
          metadata={{ type: "multipleChoice", select, layout: "vertical" }}
          body="Question"
          responseItems={["A", "B"]}
          name="answer"
          value={undefined}
          save={save}
        />,
      ),
    );
    act(() => dom.querySelector("input")!.click());
    expect(save).toHaveBeenCalledTimes(1);
    expect(record().pointerStats).toMatchObject({
      clickCount: 1,
      clickSamples: [{ source: "unknown", position: null }],
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  },
);

test("shared choices omit participant pointer telemetry", () => {
  act(() =>
    root.render(
      <Prompt
        metadata={{
          type: "multipleChoice",
          select: "single",
          layout: "vertical",
        }}
        body="Question"
        responseItems={["A", "B"]}
        name="answer"
        value={undefined}
        shared
        save={save}
      />,
    ),
  );
  act(() => dom.querySelector("input")!.click());
  expect(save).toHaveBeenCalledTimes(1);
  expect(record()).not.toHaveProperty("pointerStats");
});

test("cutoff drops unsaved telemetry and the next prompt starts fresh", () => {
  const render = (stageId: string) =>
    act(() =>
      root.render(
        <Prompt
          metadata={{ type: "openResponse" }}
          body="Question"
          responseItems={[]}
          name="answer"
          stageId={stageId}
          value={undefined}
          save={save}
        />,
      ),
    );
  render("first");
  act(() => {
    const field = dom.querySelector("textarea")!;
    field.focus();
    field.click();
  });
  render("second");
  expect(save).not.toHaveBeenCalled();
  act(() => {
    const field = dom.querySelector("textarea")!;
    field.focus();
    field.blur();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(record().pointerStats).toMatchObject({ clickCount: 0, focusCount: 1 });
});

test("changing a prompt to an unsupported control does not export stale pointer stats", () => {
  act(() =>
    root.render(
      <Prompt
        metadata={{ type: "openResponse" }}
        body="Question"
        responseItems={[]}
        name="answer"
        value={undefined}
        save={save}
      />,
    ),
  );
  act(() => {
    dom.querySelector("textarea")!.click();
  });
  act(() =>
    root.render(
      <Prompt
        metadata={{ type: "dropdown" }}
        body="Question"
        responseItems={["A", "B"]}
        name="answer"
        value={undefined}
        save={save}
      />,
    ),
  );
  expect(save).toHaveBeenCalledTimes(1);
  expect(record().value).toBe("A");
  expect(record()).not.toHaveProperty("pointerStats");
});
