// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Button } from "./Button.js";
import { RadioGroup } from "./RadioGroup.js";
import { CheckboxGroup } from "./CheckboxGroup.js";
import { SubmitButton } from "../elements/SubmitButton.js";

let root: Root;
let dom: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  dom = document.createElement("div");
  document.body.appendChild(dom);
  root = createRoot(dom);
});

afterEach(() => {
  act(() => root.unmount());
  dom.remove();
});

const options = [{ key: "a", value: "Alpha" }];

for (const control of ["button", "radio", "checkbox"] as const) {
  test(`${control} publishes the current snapshot before its existing action callback`, () => {
    const snapshots = vi.fn();
    const action = vi.fn(() => {
      expect(snapshots).toHaveBeenCalledTimes(1);
    });
    act(() => {
      root.render(
        control === "button" ? (
          <Button onPointerSnapshot={snapshots} onClick={action}>
            Continue
          </Button>
        ) : control === "radio" ? (
          <RadioGroup
            options={options}
            onPointerSnapshot={snapshots}
            onChange={action}
          />
        ) : (
          <CheckboxGroup
            options={options}
            value={[]}
            onPointerSnapshot={snapshots}
            onChange={action}
          />
        ),
      );
    });
    expect(snapshots).toHaveBeenCalledTimes(1);
    snapshots.mockClear();
    act(() => {
      dom.querySelector<HTMLElement>("button, input")!.click();
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveBeenCalledTimes(1);
  });
}

test("submit attaches telemetry to its existing save without saving focus, hover or canceled presses", () => {
  const save = vi.fn();
  const submit = vi.fn();
  act(() => {
    root.render(
      <SubmitButton
        name="continue"
        onSubmit={submit}
        save={save}
        getElapsedTime={() => 12}
      />,
    );
  });
  const button = dom.querySelector("button")!;
  act(() => {
    button.focus();
    button.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));
    button.blur();
  });
  expect(save).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  act(() => {
    button.click();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("submitButton_continue", {
    time: 12,
    pointerStats: expect.any(Object) as unknown,
  });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(
    submit.mock.invocationCallOrder[0],
  );
});
