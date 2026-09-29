// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DebugMessage } from "../../utils/promptTelemetry.js";
import type { NumberFormat } from "../../messages/types.js";
import { NumericInput } from "./NumericInput.js";

let root: Root;
let dom: HTMLDivElement;
const save = vi.fn<(entry: string, format: NumberFormat) => void>();
const debug = vi.fn<(message: DebugMessage) => void>();
const dot = { decimal: ".", grouping: "," };
const comma = { decimal: ",", grouping: "." };
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
  debug.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function render(props: React.ComponentProps<typeof NumericInput> = {}) {
  act(() =>
    root.render(
      <NumericInput onChange={save} onDebugMessage={debug} {...props} />,
    ),
  );
}
function input() {
  return dom.querySelector("input")!;
}
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
function insert(inserted: string) {
  act(() => {
    input().focus();
    const field = input();
    const before = field.value;
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    const native = field.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: inserted,
      }),
    );
    if (native) {
      // jsdom dispatches beforeinput but does not perform its default edit.
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(
        field,
        before.slice(0, start) + inserted + before.slice(end),
      );
      field.setSelectionRange(start + inserted.length, start + inserted.length);
      field.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: inserted,
        }),
      );
    }
  });
}
function fallbackEdit(
  value: string,
  data: string | null = null,
  inputType = "insertReplacementText",
) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType,
        data,
      }),
    );
  });
}

test("accepted edits commit after two seconds and maximum wait stays five seconds", () => {
  render();
  insert("2");
  advance(1999);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(save).toHaveBeenLastCalledWith("2", dot);
  for (let i = 0; i < 5; i++) {
    insert("5");
    advance(1000);
  }
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith("255555", dot);
});

test("blur saves empty raw text and fresh typing telemetry before the response", () => {
  render();
  act(() => {
    input().focus();
    input().blur();
  });
  expect(save).toHaveBeenCalledWith("", dot);
  expect(debug).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "typingStats",
      focusCount: 1,
      blurCount: 1,
    }),
  );
  expect(debug.mock.invocationCallOrder[0]).toBeLessThan(
    save.mock.invocationCallOrder[0],
  );
});

test("a refused insertion preserves a selection and does not extend pending timers", () => {
  render();
  insert("35");
  advance(1500);
  act(() => input().setSelectionRange(0, 2));
  insert("a");
  expect(input().value).toBe("35");
  expect(input().selectionStart).toBe(0);
  expect(input().selectionEnd).toBe(2);
  advance(500);
  expect(save).toHaveBeenCalledWith("35", dot);
});

test("fallback autofill filters only inserted characters", () => {
  render({ entry: "35" });
  fallbackEdit("3x45", "x4");
  expect(input().value).toBe("345");
  advance(2000);
  expect(save).toHaveBeenCalledWith("345", dot);
});

test("restored format survives no-edit blur and switches only after an accepted edit", () => {
  render({ entry: "1,5", numberFormat: comma, nextEditNumberFormat: dot });
  act(() => {
    input().focus();
    input().blur();
  });
  expect(save).toHaveBeenLastCalledWith("1,5", comma);
  act(() => input().setSelectionRange(3, 3));
  insert("x");
  act(() => input().blur());
  expect(save).toHaveBeenLastCalledWith("1,5", comma);
  act(() => input().setSelectionRange(3, 3));
  insert("6");
  advance(2000);
  expect(save).toHaveBeenLastCalledWith("1,56", dot);
});

test("composition is untouched until its completed insertion is filtered once", () => {
  render({ entry: "35" });
  act(() => input().setSelectionRange(1, 1));
  act(() => {
    input().dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  fallbackEdit("3あ5");
  expect(input().value).toBe("3あ5");
  advance(6000);
  expect(save).not.toHaveBeenCalled();
  fallbackEdit("3x45");
  act(() => {
    input().dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "x4" }),
    );
  });
  expect(input().value).toBe("345");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenLastCalledWith("345", dot);
});

test("paste and drop are blocked and recorded; drop commits unchanged text", () => {
  render({ entry: "25" });
  for (const type of ["paste", "drop"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(
      event,
      type === "paste" ? "clipboardData" : "dataTransfer",
      { value: { getData: () => "123" } },
    );
    act(() => {
      input().dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  }
  expect(input().value).toBe("25");
  expect(debug.mock.calls.map(([message]) => message)).toEqual([
    expect.objectContaining({ type: "pasteAttempt", length: 3 }),
    expect.objectContaining({ type: "pasteAttempt", length: 3 }),
  ]);
  expect(save).toHaveBeenLastCalledWith("25", dot);
});

test("unmount cancels pending numeric response", () => {
  render();
  insert("5");
  act(() => root.render(null));
  advance(10000);
  expect(save).not.toHaveBeenCalled();
});

test("refused keystrokes count in telemetry without creating a commit", () => {
  render();
  act(() => {
    input().focus();
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "x", bubbles: true }),
    );
  });
  insert("x");
  advance(6000);
  expect(save).not.toHaveBeenCalled();
  act(() => input().blur());
  expect(debug).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "typingStats",
      totalKeystrokes: 1,
      blurCount: 1,
    }),
  );
});

test("numeric hooks stay ordered while required, integer and affixes change", () => {
  const error = vi.spyOn(console, "error");
  for (const enabled of [false, true, false]) {
    render({
      constraints: { required: enabled, integer: enabled },
      prefix: enabled ? "$" : undefined,
      suffix: enabled ? "years" : undefined,
    });
    expect(input().getAttribute("aria-required")).toBe(enabled ? "true" : null);
    expect(dom.querySelectorAll("bdi")).toHaveLength(enabled ? 2 : 0);
  }
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test("a noncancelable beforeinput waits for the browser mutation before filtering", () => {
  render({ entry: "35" });
  act(() => {
    input().setSelectionRange(1, 1);
    input().dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        inputType: "insertText",
        data: "x4",
      }),
    );
  });
  expect(input().value).toBe("35");
  fallbackEdit("3x45", "x4");
  expect(input().value).toBe("345");
  advance(2000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("345", dot);
});

test("a same-entry restored format update reparses the visible feedback", () => {
  render({ entry: "1,5", numberFormat: comma });
  expect(
    dom
      .querySelector('[data-testid="numeric-feedback"]')
      ?.getAttribute("data-state"),
  ).toBe("valid");
  render({ entry: "1,5", numberFormat: dot });
  expect(
    dom
      .querySelector('[data-testid="numeric-feedback"]')
      ?.getAttribute("data-state"),
  ).toBe("problem");
});

test("a canceled composition preserves the original selected text and pending timing", () => {
  render();
  insert("12345");
  advance(1500);
  act(() => {
    input().setSelectionRange(1, 4);
    input().dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  fallbackEdit("1あ5");
  fallbackEdit("12345");
  act(() => {
    input().dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "" }),
    );
  });
  expect(input().value).toBe("12345");
  advance(500);
  expect(save).toHaveBeenCalledWith("12345", dot);
});

test("composition replaces its original selection only once when a final input follows", () => {
  render({ entry: "12345" });
  act(() => {
    input().setSelectionRange(1, 4);
    input().dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  fallbackEdit("1あ5");
  fallbackEdit("1x65");
  act(() => {
    input().dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "x6" }),
    );
  });
  expect(input().value).toBe("165");
  advance(1500);
  fallbackEdit("1x65", "x6");
  expect(input().value).toBe("165");
  advance(500);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("165", dot);
});

test("same-value native replacement clears revealed feedback and commits the accepted edit", () => {
  render({ entry: "3", constraints: { min: 18 } });
  const feedback = () => dom.querySelector('[data-testid="numeric-feedback"]')!;
  expect(feedback().getAttribute("data-state")).toBe("problem");
  act(() => input().setSelectionRange(0, 1));
  insert("3");
  expect(feedback().getAttribute("data-state")).toBe("neutral");
  advance(2000);
  expect(save).toHaveBeenCalledWith("3", dot);
});

test("native history insertions follow the current numeric format filter", () => {
  render({ entry: "1,5", numberFormat: comma, nextEditNumberFormat: dot });
  act(() => input().setSelectionRange(0, 3));
  insert("25");
  advance(2000);
  fallbackEdit("1,5", null, "historyUndo");
  expect(input().value).toBe("15");
  advance(2000);
  expect(save).toHaveBeenLastCalledWith("15", dot);
  fallbackEdit("25", null, "historyRedo");
  advance(2000);
  expect(save).toHaveBeenLastCalledWith("25", dot);
});

test("solo undo cannot reinsert text over the entry cap or extend its pending timer", () => {
  render({ entry: "1".repeat(101) });
  fallbackEdit("1".repeat(100), null, "deleteContentBackward");
  advance(1500);
  fallbackEdit("1".repeat(101), null, "historyUndo");
  expect(input().value).toBe("1".repeat(100));
  advance(500);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("1".repeat(100), dot);
});
