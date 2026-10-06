// @vitest-environment jsdom
import { describe, test, expect, afterEach, beforeAll } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RadioGroup } from "./RadioGroup.js";
import { CheckboxGroup } from "./CheckboxGroup.js";

// `flush` (#718) drops the spacing that sets the options under a question.
// Standalone hosts that don't pass it must keep that spacing.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
});

function spacing(node: React.ReactElement, wrapperTestId: string) {
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(node));
  const wrapper = container.querySelector<HTMLElement>(
    `[data-testid="${wrapperTestId}"]`,
  )!;
  const group = container.querySelector<HTMLElement>(
    '[role="group"], [role="radiogroup"]',
  )!;
  return {
    top: wrapper.style.marginTop,
    indent: group.style.marginInlineStart,
  };
}

const options = [{ key: "a", value: "A" }];

describe.each([
  [
    "RadioGroup",
    "radioGroup",
    (flush?: boolean) => (
      <RadioGroup options={options} onChange={() => {}} flush={flush} />
    ),
  ],
  [
    "CheckboxGroup",
    "checkboxGroup",
    (flush?: boolean) => (
      <CheckboxGroup
        options={options}
        value={[]}
        onChange={() => {}}
        flush={flush}
      />
    ),
  ],
])("%s", (_name, testId, make) => {
  test("keeps its spacing by default", () => {
    expect(spacing(make(), testId)).toEqual({ top: "1rem", indent: "1.25rem" });
  });

  test("drops its spacing when flush", () => {
    expect(spacing(make(true), testId)).toEqual({ top: "", indent: "" });
  });
});
