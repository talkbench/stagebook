// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Element } from "./Element.js";
import {
  StagebookProvider,
  useStagebookContext,
  type StagebookContext,
} from "./StagebookProvider.js";
import { ConditionsConditionalRender } from "./conditions/ConditionsConditionalRender.js";
import { StageConditionGate } from "./conditions/StageConditionGate.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function mount(
  children: React.ReactNode,
  overrides: Partial<StagebookContext> = {},
) {
  const context: StagebookContext = {
    get: () => [],
    save: () => {},
    getElapsedTime: () => 0,
    submit: () => {},
    getAssetURL: (path) => path,
    getTextContent: () => Promise.resolve(""),
    progressLabel: "stage",
    playerId: "p0",
    position: 0,
    playerCount: 3,
    isSubmitted: false,
    ...overrides,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    act(() =>
      root.render(
        <StagebookProvider value={{ ...context }}>
          {children}
        </StagebookProvider>,
      ),
    );
  render();
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, render };
}

describe("Element canonical reference reads (#757)", () => {
  test("Display preserves numeric seat order and an empty middle slot", () => {
    const records = new Map([
      ["2", { value: "Third" }],
      ["0", { value: "First" }],
    ]);
    const get = vi.fn((_key: string, scope?: string) =>
      records.has(scope ?? "") ? [records.get(scope ?? "")] : [],
    );
    const { container } = mount(
      <Element
        element={{ type: "display", reference: "everyone.prompt.answer" }}
        onSubmit={() => {}}
      />,
      { get },
    );
    expect(container.querySelector("blockquote")?.textContent).toBe(
      "First\n\nThird",
    );
    expect(container.querySelector("blockquote")?.style.whiteSpace).toBe(
      "pre-wrap",
    );
    expect(get.mock.calls.map(([, scope]) => scope)).toEqual(["0", "1", "2"]);
  });

  test("Display keeps a single participant's array answer as one value", () => {
    const { container } = mount(
      <Element
        element={{
          type: "display",
          reference: { position: "self", source: "prompt", name: "answer" },
        }}
        onSubmit={() => {}}
      />,
      { get: () => [{ value: ["red", "blue"] }] },
    );
    expect(container.querySelector("blockquote")?.textContent).toBe(
      '["red","blue"]',
    );
  });

  test("outgoing params distinguish an array answer from a group seat list", () => {
    const get = (key: string, scope?: string) =>
      key === "prompt_selected"
        ? [{ value: ["red", "blue"] }]
        : scope === "1"
          ? [{ value: "Second" }]
          : scope === "2"
            ? [{ value: "Third" }]
            : [];
    const { container } = mount(
      <Element
        element={{
          type: "trackedLink",
          name: "link",
          url: "https://example.com/",
          displayText: "Open",
          urlParams: [
            { key: "selected", reference: "self.prompt.selected" },
            {
              key: "group",
              reference: {
                position: "everyone",
                source: "prompt",
                name: "answer",
              },
            },
          ],
        }}
        onSubmit={() => {}}
      />,
      { get },
    );
    const params = new URL(container.querySelector("a")!.href).searchParams;
    expect(params.get("selected")).toBe("red,blue");
    expect(params.get("group")).toBe("Second");
  });
});

function DuplicateConditions() {
  const { readReference, onContractViolation, violationKeys } =
    useStagebookContext();
  const props = {
    readReference,
    onViolation: onContractViolation,
    violationKeys,
    conditions: {
      reference: "self.prompt.age",
      comparator: "isAtLeast" as const,
      value: 18,
    },
  };
  return (
    <>
      <ConditionsConditionalRender {...props}>one</ConditionsConditionalRender>
      <ConditionsConditionalRender {...props}>two</ConditionsConditionalRender>
    </>
  );
}

test("provider forwards sanitized type mismatches once across consumers and rerenders", () => {
  const onContractViolation = vi.fn();
  const { container, render } = mount(<DuplicateConditions />, {
    get: () => [{ value: "private answer" }],
    onContractViolation,
  });
  render();
  expect(container.textContent).toBe("");
  expect(onContractViolation).toHaveBeenCalledTimes(1);
  expect(onContractViolation).toHaveBeenCalledWith({
    kind: "typeMismatch",
    reference: "self.prompt.age",
    expected: "number",
    actual: "string",
  });
  expect(JSON.stringify(onContractViolation.mock.calls)).not.toContain(
    "private answer",
  );
});

test("stage negation remains active before data arrives, then advances once", () => {
  let stored: unknown[] = [];
  const advanceStage = vi.fn();
  const { container, render } = mount(
    <StageConditionGate
      conditions={{
        none: { reference: "shared.submitButton.finish", comparator: "exists" },
      }}
    >
      stage body
    </StageConditionGate>,
    { get: () => stored, advanceStage },
  );
  expect(container.textContent).toBe("stage body");
  expect(advanceStage).not.toHaveBeenCalled();
  stored = [{ time: 2 }];
  render();
  render();
  expect(advanceStage).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-state="advancing"]')).not.toBeNull();
});
