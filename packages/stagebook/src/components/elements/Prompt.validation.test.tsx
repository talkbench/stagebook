// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Prompt, type PromptProps } from "./Prompt.js";
import { checkResponse } from "../../utils/checkResponse.js";
import { TextArea } from "../form/TextArea.js";
import type { MetadataType } from "../../schemas/promptFile.js";

let root: Root;
let dom: HTMLDivElement;
const save = vi.fn();
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
  vi.restoreAllMocks();
});
function render(node: React.ReactNode) {
  act(() => root.render(node));
}
function edit(value: string) {
  const input = dom.querySelector("textarea")!;
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function StatefulPrompt(
  props: Partial<PromptProps> & { metadata: MetadataType },
) {
  const [value, setValue] = useState<unknown>(undefined);
  return (
    <Prompt
      name="answer"
      body="Your answer"
      responseItems={["Alpha", "Beta"]}
      value={value}
      save={(key, record, scope) => {
        const response = record as { value: unknown; isValid?: boolean };
        if (scope === "player") {
          const constraints = {
            required:
              "required" in props.metadata
                ? props.metadata.required
                : undefined,
            ...(props.metadata.type === "openResponse"
              ? {
                  minLength: props.metadata.minLength,
                  maxLength: props.metadata.maxLength,
                }
              : {}),
          };
          expect(response.isValid).toBe(
            checkResponse(response.value, constraints).isValid,
          );
        } else {
          expect(response).not.toHaveProperty("isValid");
        }
        save(key, record, scope);
        setValue((record as { value: unknown }).value);
      }}
      {...props}
    />
  );
}
function saved() {
  return save.mock.calls.at(-1)?.[1] as { value: unknown; isValid?: boolean };
}
const textMetadata = {
  name: "answer",
  type: "openResponse",
  required: true,
  minLength: 3,
} as const;

test("required text saves validity at quiet commits and blur, including empty blur", () => {
  render(<StatefulPrompt metadata={textMetadata} />);
  expect(save).not.toHaveBeenCalled();
  act(() => {
    dom.querySelector("textarea")!.focus();
    dom.querySelector("textarea")!.blur();
  });
  expect(saved()).toMatchObject({ value: "", isValid: false });
  for (const [value, isValid] of [
    ["ab", false],
    ["abc", true],
    ["   ", false],
    ["", false],
  ] as const) {
    edit(value);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(saved()).toMatchObject({ value, isValid });
    act(() => dom.querySelector("textarea")!.blur());
    expect(saved()).toMatchObject({ value, isValid });
  }
});

for (const numeric of [false, true]) {
  test(`radio ${numeric ? "numeric" : "text"} commits validity immediately`, () => {
    render(
      <StatefulPrompt
        metadata={{ name: "answer", type: "multipleChoice", required: true }}
        responsePoints={numeric ? [0, 1] : undefined}
      />,
    );
    act(() => dom.querySelector("input")!.click());
    expect(saved()).toMatchObject({
      value: numeric ? 0 : "Alpha",
      isValid: true,
    });
  });
}

test("checkbox commits invalid empty array when cleared", () => {
  render(
    <StatefulPrompt
      metadata={{
        name: "answer",
        type: "multipleChoice",
        select: "multiple",
        required: true,
      }}
    />,
  );
  act(() => dom.querySelector("input")!.click());
  expect(saved()).toMatchObject({ value: ["Alpha"], isValid: true });
  act(() => dom.querySelector("input")!.click());
  expect(saved()).toMatchObject({ value: [], isValid: false });
});

for (const placeholder of [undefined, "Choose"]) {
  test(`dropdown ${placeholder ? "placeholder waits for selection" : "default saves on mount"}`, () => {
    render(
      <StatefulPrompt
        metadata={{ name: "answer", type: "dropdown", placeholder }}
      />,
    );
    if (placeholder) expect(save).not.toHaveBeenCalled();
    else expect(saved()).toMatchObject({ value: "Alpha", isValid: true });
    act(() => {
      const input = dom.querySelector("select")!;
      input.value = "Beta";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(saved()).toMatchObject({ value: "Beta", isValid: true });
  });
}

test("shared records omit isValid on mount and changes", () => {
  render(
    <StatefulPrompt shared metadata={{ name: "answer", type: "dropdown" }} />,
  );
  expect(save).toHaveBeenCalled();
  expect(saved()).not.toHaveProperty("isValid");
  act(() => {
    const input = dom.querySelector("select")!;
    input.value = "Beta";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(saved()).not.toHaveProperty("isValid");
  expect(save.mock.calls.every((call) => call[2] === "shared")).toBe(true);
});

test("required toggles false → true → false without changing hook order", () => {
  const error = vi.spyOn(console, "error");
  for (const required of [false, true, false]) {
    render(
      <Prompt
        metadata={{ ...textMetadata, required }}
        name="answer"
        body="Your answer"
        responseItems={[]}
        value={undefined}
        save={save}
      />,
    );
    expect(
      dom.querySelector('[data-testid="required-marker"]')?.textContent ?? null,
    ).toBe(required ? "Required" : null);
    expect(dom.querySelector("textarea")!.getAttribute("aria-required")).toBe(
      required ? "true" : null,
    );
  }
  expect(error).not.toHaveBeenCalled();
});

const counterCases = [
  { text: "", minLength: 3, state: "default", isValid: true },
  { text: "   ", minLength: 3, state: "default", isValid: true },
  { text: " \n\t ", minLength: 3, state: "default", isValid: true },
  { text: "ab", minLength: 3, state: "default", isValid: false },
  { text: "abc", minLength: 3, state: "valid", isValid: true },
  { text: "abcde", minLength: 3, maxLength: 5, state: "valid", isValid: true },
  { text: "abc", maxLength: 5, state: "default", isValid: true },
  { text: "😀", minLength: 2, maxLength: 2, state: "valid", isValid: true },
];
test.each(counterCases)(
  "counter state for $text with min $minLength and max $maxLength",
  ({ text, minLength, maxLength, state, isValid }) => {
    expect(checkResponse(text, { minLength, maxLength }).isValid).toBe(isValid);
    render(
      <TextArea
        value={text}
        showCharacterCount
        minLength={minLength}
        maxLength={maxLength}
      />,
    );
    expect(
      dom
        .querySelector('[data-testid="char-counter"]')!
        .getAttribute("data-state"),
    ).toBe(state);
  },
);

test("slider click saves validity with its numeric value", () => {
  render(
    <StatefulPrompt
      metadata={{
        name: "answer",
        type: "slider",
        min: 0,
        max: 10,
        interval: 1,
      }}
    />,
  );
  const track = dom.querySelector('[data-testid="slider-track"]')!;
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    right: 100,
    top: 0,
    bottom: 10,
    width: 100,
    height: 10,
    toJSON() {},
  });
  act(() => {
    track.dispatchEvent(
      new MouseEvent("click", { clientX: 50, bubbles: true }),
    );
  });
  expect(saved()).toMatchObject({ value: 5, isValid: true });
});

test("listSorter keyboard drag saves the reordered response and validity", () => {
  render(<StatefulPrompt metadata={{ name: "answer", type: "listSorter" }} />);
  const row = dom.querySelector('[data-testid="draggable-0"]')!;
  const press = (key: string, keyCode: number) => {
    act(() => {
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key, keyCode, bubbles: true }),
      );
    });
  };
  act(() => (row as HTMLElement).focus());
  press(" ", 32);
  act(() => {
    vi.advanceTimersByTime(50);
  });
  press("ArrowDown", 40);
  act(() => {
    vi.advanceTimersByTime(50);
  });
  press(" ", 32);
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(saved()).toMatchObject({ value: ["Beta", "Alpha"], isValid: true });
});
