// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePointerTelemetry } from "./usePointerTelemetry.js";
import type {
  PointerControlType,
  PointerStats,
} from "../../utils/pointerTelemetry.js";

let root: Root;
let host: HTMLDivElement;
let telemetry: ReturnType<typeof usePointerTelemetry>;
let notified: PointerStats[];
let saved: PointerStats[];

function Harness({ kind = "text" }: { kind?: PointerControlType }) {
  const ref = useRef<HTMLDivElement>(null);
  telemetry = usePointerTelemetry(ref, {
    controlType: kind,
    onSnapshot: (stats) => notified.push(stats),
  });
  return (
    <div ref={ref}>
      {kind === "button" ? (
        <button onClick={() => saved.push(telemetry.snapshot())}>
          <span>Go</span>
        </button>
      ) : kind === "radio" || kind === "checkbox" ? (
        <>
          <label>
            <input
              type={kind}
              name="choice"
              onChange={() => saved.push(telemetry.snapshot())}
            />
            One
          </label>
          <label>
            <input
              type={kind}
              name="choice"
              onChange={() => saved.push(telemetry.snapshot())}
            />
            Two
          </label>
        </>
      ) : (
        <>
          <label htmlFor="field">Response</label>
          <div data-pointer-field>
            <span>Prefix</span>
            <textarea id="field" />
          </div>
          <p>Feedback</p>
        </>
      )}
    </div>
  );
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  notified = [];
  saved = [];
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
function render(kind: PointerControlType = "text") {
  act(() => root.render(<Harness key={kind} kind={kind} />));
  for (const element of host.querySelectorAll(
    "label,input,textarea,button,[data-pointer-field]",
  )) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 110,
      bottom: 60,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    });
  }
}
const field = () => host.querySelector("textarea")!;
function pointer(
  target: Element,
  type = "pointerdown",
  pointerType = "mouse",
  x = 60,
  y = 40,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    detail: 1,
  });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: 1 },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}
function click(target: Element, x = 60, y = 40) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        detail: 1,
      }),
    );
  });
}
function physicalClick(target: Element, pointerType = "mouse") {
  pointer(target, "pointerdown", pointerType);
  pointer(target, "pointerup", pointerType);
  click(target);
}
function key(target: Element, key: string, type = "keydown") {
  act(() => {
    target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key }));
  });
}

test("publishes an initial zero snapshot without saving", () => {
  expect(notified).toHaveLength(1);
  expect(notified[0]).toMatchObject({
    version: 1,
    controlType: "text",
    clickCount: 0,
    focusCount: 0,
  });
  expect(saved).toHaveLength(0);
});

test("captures first empty entry before focus, then populated reentry and focused clicks", () => {
  pointer(field());
  act(() => field().focus());
  pointer(field(), "pointerup");
  click(field());
  expect(telemetry.snapshot().clickSamples[0].fieldState).toEqual({
    wasFocused: false,
    wasEmpty: true,
    priorFocusCount: 0,
  });
  expect(telemetry.snapshot().focusSamples[0]).toMatchObject({
    visit: "first",
    source: "pointer",
    coordinateEvent: "pointerdown",
  });
  field().value = "answer";
  physicalClick(field());
  expect(telemetry.snapshot().clickSamples[1].fieldState).toEqual({
    wasFocused: true,
    wasEmpty: false,
    priorFocusCount: 1,
  });
  act(() => field().blur());
  pointer(field());
  act(() => field().focus());
  pointer(field(), "pointerup");
  click(field());
  expect(telemetry.snapshot().focusSamples[1]).toMatchObject({
    visit: "return",
    fieldState: { wasEmpty: false, priorFocusCount: 1 },
  });
});

test("placeholders do not count as text", () => {
  field().placeholder = "Some text";
  physicalClick(field());
  expect(telemetry.snapshot().clickSamples[0].fieldState?.wasEmpty).toBe(true);
});

test.each(["mouse", "touch", "pen", "unexpected"])(
  "records bounded pointer type %s",
  (pointerType) => {
    physicalClick(field(), pointerType);
    expect(telemetry.snapshot().clickSamples[0]).toMatchObject({
      source: "pointer",
      pointerType: pointerType === "unexpected" ? "unknown" : pointerType,
      coordinateEvent: "click",
      position: { x: 0.5, y: 0.5 },
    });
  },
);

test("unknown activation has no invented position even with nonzero click coordinates", () => {
  click(field());
  expect(telemetry.snapshot().clickSamples[0]).toMatchObject({
    source: "unknown",
    pointerType: null,
    position: null,
    controlPosition: null,
    coordinateEvent: null,
  });
});

test("button keyboard activation retains key evidence through keyup", () => {
  render("button");
  const button = host.querySelector("button")!;
  key(button, " ");
  key(button, " ", "keyup");
  click(button, 60, 40);
  expect(saved[0].clickSamples[0]).toMatchObject({
    source: "keyboard",
    position: null,
  });
  click(button);
  expect(telemetry.snapshot().clickSamples[1].source).toBe("unknown");
});

test("radio arrow provenance follows selection to the next control before save", () => {
  render("radio");
  const inputs = host.querySelectorAll("input");
  act(() => inputs[0].focus());
  key(inputs[0], "ArrowDown");
  act(() => inputs[1].focus());
  click(inputs[1]);
  expect(saved[0].clickSamples[0]).toMatchObject({
    source: "keyboard",
    position: null,
  });
});

test("label forwarding records one physical activation before React onChange", () => {
  render("checkbox");
  const label = host.querySelector("label")!;
  physicalClick(label);
  expect(telemetry.snapshot().clickCount).toBe(1);
  expect(saved).toHaveLength(1);
  expect(saved[0].clickSamples[0]).toMatchObject({ source: "pointer" });
});

test("Firefox-style forwarded pointer click is deduplicated without inspecting detail", () => {
  render("radio");
  const label = host.querySelector("label")!;
  pointer(label);
  pointer(label, "pointerup");
  // A generic event avoids JSDOM's own label activation, allowing us to replay
  // the uncanceled label click followed by Firefox's pointer-like forwarding.
  const event = new Event("click", { bubbles: true });
  Object.defineProperties(event, {
    clientX: { value: 60 },
    clientY: { value: 40 },
    detail: { value: 1 },
  });
  act(() => {
    label.dispatchEvent(event);
  });
  pointer(host.querySelector("input")!, "click");
  expect(telemetry.snapshot().clickCount).toBe(1);
});

test("a canceled label activation cannot swallow a later direct activation", () => {
  render("radio");
  const label = host.querySelector("label")!;
  label.addEventListener("click", (event) => event.preventDefault(), {
    once: true,
  });
  physicalClick(label);
  act(() => host.querySelector("input")!.click());
  expect(telemetry.snapshot().clickCount).toBe(2);
  expect(telemetry.snapshot().clickSamples[1].source).toBe("unknown");
});

test("label focus retains label geometry and attribution after forwarded click", () => {
  const label = host.querySelector("label")!;
  physicalClick(label);
  act(() => field().focus());
  expect(telemetry.snapshot().clickCount).toBe(1);
  expect(telemetry.snapshot().clickSamples[0].targetPart).toBe("label");
  expect(telemetry.snapshot().focusSamples[0]).toMatchObject({
    source: "pointer",
    targetPart: "label",
  });
});

test("numeric decoration can focus the field without claiming direct field targeting", () => {
  render("numeric");
  const prefix = host.querySelector("span")!;
  pointer(prefix);
  pointer(prefix, "pointerup");
  click(prefix);
  act(() => field().focus());
  expect(telemetry.snapshot().focusSamples[0]).toMatchObject({
    targetPart: "padding",
    source: "pointer",
  });
});

test("Tab focus from outside is keyboard evidence; unrelated focus is unknown", () => {
  key(document.body, "Tab");
  act(() => field().focus());
  expect(telemetry.snapshot().focusSamples[0].source).toBe("keyboard");
  act(() => field().blur());
  act(() => field().focus());
  expect(telemetry.snapshot().focusSamples[1]).toMatchObject({
    source: "unknown",
    position: null,
  });
});

test("canceled, stale, and outside pointer interactions cannot supply coordinates", () => {
  pointer(field());
  pointer(field(), "pointercancel");
  click(field());
  pointer(field());
  vi.advanceTimersByTime(30001);
  click(field());
  pointer(field());
  pointer(document.body);
  click(field());
  expect(
    telemetry.snapshot().clickSamples.map((sample) => sample.source),
  ).toEqual(["unknown", "unknown", "unknown"]);
});

test("later unassociated clicks cannot inherit consumed pointer evidence", () => {
  physicalClick(field());
  click(field());
  expect(
    telemetry.snapshot().clickSamples.map((sample) => sample.source),
  ).toEqual(["pointer", "unknown"]);
});

test("unrelated root content is ignored and button child geometry uses the button", () => {
  physicalClick(host.querySelector("p")!);
  expect(telemetry.snapshot().clickCount).toBe(0);
  render("button");
  physicalClick(host.querySelector("span")!);
  expect(telemetry.snapshot().clickSamples[0].position).toMatchObject({
    width: 100,
    height: 40,
  });
});

test("caps both sample arrays while counters continue and snapshots remain detached", () => {
  physicalClick(field());
  const earlier = telemetry.snapshot();
  for (let i = 0; i < 24; i++) {
    pointer(field());
    act(() => field().focus());
    pointer(field(), "pointerup");
    click(field());
    act(() => field().blur());
  }
  const stats = telemetry.snapshot();
  expect(stats.clickCount).toBe(25);
  expect(stats.clickSamples).toHaveLength(20);
  expect(stats.focusCount).toBe(24);
  expect(stats.focusSamples).toHaveLength(20);
  expect(stats.clickCountsBySource.pointer).toBe(25);
  expect(stats.focusCountsBySource.pointer).toBe(24);
  stats.clickSamples[0].position!.x = 99;
  stats.clickCountsBySource.pointer = 999;
  expect(earlier.clickCount).toBe(1);
  expect(earlier.clickSamples).toHaveLength(1);
  expect(telemetry.snapshot().clickSamples[0].position!.x).toBe(0.5);
  expect(telemetry.snapshot().clickCountsBySource.pointer).toBe(25);
});

test("a programmatic click during or after pointerdown cannot borrow its position", () => {
  pointer(field());
  act(() => field().click());
  pointer(field(), "pointerup");
  act(() => field().click());
  expect(
    telemetry.snapshot().clickSamples.map((sample) => sample.source),
  ).toEqual(["unknown", "unknown"]);
});

test("focus movement without relatedTarget preserves the pending choice interaction", () => {
  render("radio");
  const inputs = host.querySelectorAll("input");
  act(() => inputs[0].focus());
  key(inputs[0], "ArrowDown");
  act(() => {
    inputs[0].dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  click(inputs[1]);
  expect(telemetry.snapshot().clickSamples[0].source).toBe("keyboard");
  pointer(inputs[0]);
  act(() => {
    inputs[1].dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  pointer(inputs[0], "pointerup");
  click(inputs[0]);
  expect(telemetry.snapshot().clickSamples[1].source).toBe("pointer");
});

test("Tab evidence is consumed when focus goes to a different component", () => {
  const outside = document.createElement("button");
  document.body.appendChild(outside);
  key(document.body, "Tab");
  act(() => outside.focus());
  act(() => field().focus());
  expect(telemetry.snapshot().focusSamples[0].source).toBe("unknown");
  outside.remove();
});

test("focus placement uses the geometry observed at pointerdown", () => {
  pointer(field());
  vi.spyOn(field(), "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 210,
    bottom: 60,
    width: 200,
    height: 40,
    toJSON: () => ({}),
  });
  act(() => field().focus());
  expect(telemetry.snapshot().focusSamples[0].position).toMatchObject({
    x: 0.5,
    width: 100,
  });
});
