// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
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
let documentAdded: MockInstance<Document["addEventListener"]>;
let documentRemoved: MockInstance<Document["removeEventListener"]>;
let windowAdded: MockInstance<Window["addEventListener"]>;
let windowRemoved: MockInstance<Window["removeEventListener"]>;
let bounds: MockInstance<Element["getBoundingClientRect"]>;
let ranges: MockInstance<Document["createRange"]>;

interface HarnessProps {
  kind?: PointerControlType;
  onSnapshot?: (stats: PointerStats) => void;
}

function Harness({ kind = "text", onSnapshot }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  telemetry = usePointerTelemetry(ref, { controlType: kind, onSnapshot });
  return (
    <div ref={ref}>
      {kind === "button" ? (
        <button onClick={() => saved.push(telemetry.snapshot())}>Go</button>
      ) : kind === "radio" || kind === "checkbox" ? (
        <label>
          <input
            type={kind}
            onChange={() => saved.push(telemetry.snapshot())}
          />
          One
        </label>
      ) : (
        <label>
          Response
          <textarea />
        </label>
      )}
    </div>
  );
}

const receive = (stats: PointerStats) => notified.push(stats);
function render(props: HarnessProps = { onSnapshot: receive }) {
  act(() => root.render(<Harness {...props} />));
}

function rectangle(width = 100): DOMRect {
  return {
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 10 + width,
    bottom: 60,
    width,
    height: 40,
    toJSON: () => ({}),
  };
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
  documentAdded = vi.spyOn(document, "addEventListener");
  documentRemoved = vi.spyOn(document, "removeEventListener");
  windowAdded = vi.spyOn(window, "addEventListener");
  windowRemoved = vi.spyOn(window, "removeEventListener");
  bounds = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      return rectangle(this.tagName === "INPUT" ? 20 : 100);
    });
  ranges = vi.spyOn(document, "createRange").mockImplementation(
    () =>
      ({
        selectNodeContents: () => undefined,
        getClientRects: () => [rectangle()],
      }) as unknown as Range,
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const field = () => host.querySelector("textarea")!;
const target = () => host.querySelector("button,label")!;
const geometry = () => bounds;
const textGeometry = () => ranges;
function clearGeometry() {
  geometry().mockClear();
  textGeometry().mockClear();
}
function expectNoGeometry() {
  expect(geometry()).not.toHaveBeenCalled();
  expect(textGeometry()).not.toHaveBeenCalled();
}

function pointer(target: Element, type = "pointerdown", pointerType = "mouse") {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: 60,
    clientY: 40,
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
function click(target: Element) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 60,
        clientY: 40,
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
function focusVisit(withClick = false) {
  pointer(field());
  act(() => field().focus());
  pointer(field(), "pointerup");
  if (withClick) click(field());
  act(() => field().blur());
}

test.each<PointerControlType>([
  "text",
  "numeric",
  "button",
  "radio",
  "checkbox",
])(
  "%s without a consumer installs no document listeners and collects nothing",
  (kind) => {
    render({ kind });
    const observedEvents = [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "keydown",
      "focusin",
    ];
    expect(
      documentAdded.mock.calls.filter(([event]) =>
        observedEvents.includes(event),
      ),
    ).toHaveLength(0);
    expect(
      windowAdded.mock.calls.filter(([event]) => event === "blur"),
    ).toHaveLength(0);
    physicalClick(target());
    const control = host.querySelector<HTMLElement>("textarea,input,button")!;
    act(() => control.focus());
    expectNoGeometry();
    expect(telemetry.snapshot()).toMatchObject({
      clickCount: 0,
      focusCount: 0,
    });
    expect(notified).toHaveLength(0);
    if (kind === "button" || kind === "radio" || kind === "checkbox")
      expect(saved).toHaveLength(1);
  },
);

test("adding and removing a consumer pauses observation while preserving prior samples", () => {
  render({});
  physicalClick(field());
  render();
  expect(notified.at(-1)?.clickCount).toBe(0);
  physicalClick(field());
  const beforePause = telemetry.snapshot();
  pointer(field());
  render({});
  expect(
    documentRemoved.mock.calls.filter(([event]) => event === "pointerdown"),
  ).toHaveLength(1);
  expect(
    windowRemoved.mock.calls.filter(([event]) => event === "blur"),
  ).toHaveLength(1);
  clearGeometry();
  physicalClick(field());
  act(() => field().focus());
  expectNoGeometry();
  expect(telemetry.snapshot()).toEqual(beforePause);
  render();
  expect(notified.at(-1)).toEqual(beforePause);
  pointer(field(), "pointerup");
  click(field());
  expect(telemetry.snapshot().clickSamples[1].source).toBe("unknown");
  physicalClick(field());
  expect(telemetry.snapshot().clickCountsBySource).toEqual({
    pointer: 2,
    keyboard: 0,
    unknown: 1,
  });
});

test("changing only callback identity keeps the current interaction and listeners", () => {
  render();
  pointer(field());
  documentAdded.mockClear();
  documentRemoved.mockClear();
  const replacement = vi.fn();
  render({ onSnapshot: replacement });
  expect(documentAdded).not.toHaveBeenCalled();
  expect(documentRemoved).not.toHaveBeenCalled();
  pointer(field(), "pointerup");
  click(field());
  expect(replacement).toHaveBeenCalledTimes(1);
  expect(telemetry.snapshot().clickSamples[0].source).toBe("pointer");
});

test.each<PointerControlType>(["text", "numeric"])(
  "%s stops geometry after both caps while source and pointer counts continue",
  (kind) => {
    render({ kind, onSnapshot: receive });
    for (let i = 0; i < 20; i++) focusVisit(true);
    const earlier = telemetry.snapshot();
    clearGeometry();
    focusVisit(true);
    physicalClick(field(), "touch");
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      );
      field().focus();
    });
    click(field());
    expectNoGeometry();
    expect(telemetry.snapshot()).toMatchObject({
      clickCount: 23,
      focusCount: 22,
      clickCountsBySource: { pointer: 22, keyboard: 0, unknown: 1 },
      clickCountsByPointerType: { mouse: 21, touch: 1, pen: 0, unknown: 0 },
      focusCountsBySource: { pointer: 21, keyboard: 1, unknown: 0 },
      clickSamples: earlier.clickSamples,
      focusSamples: earlier.focusSamples,
    });
    expect(notified.at(-1)?.clickCount).toBe(23);
  },
);

test("a full click cap still captures focus geometry before a layout change", () => {
  render();
  for (let i = 0; i < 20; i++) physicalClick(field());
  clearGeometry();
  pointer(field());
  expect(geometry()).toHaveBeenCalled();
  geometry().mockReturnValue(rectangle(200));
  act(() => field().focus());
  pointer(field(), "pointerup");
  clearGeometry();
  click(field());
  expectNoGeometry();
  expect(telemetry.snapshot().focusSamples[0]).toMatchObject({
    source: "pointer",
    position: { width: 100, x: 0.5 },
    fieldState: { priorFocusCount: 0 },
  });
  expect(telemetry.snapshot().clickCount).toBe(21);
});

test("a full focus cap skips down geometry but still captures click placement and field state", () => {
  render();
  for (let i = 0; i < 20; i++) focusVisit();
  clearGeometry();
  pointer(field());
  expectNoGeometry();
  act(() => field().focus());
  pointer(field(), "pointerup");
  expectNoGeometry();
  geometry().mockReturnValue(rectangle(200));
  click(field());
  expect(geometry()).toHaveBeenCalled();
  expect(telemetry.snapshot().clickSamples[0]).toMatchObject({
    source: "pointer",
    position: { width: 200, x: 0.25 },
    fieldState: { wasFocused: false, wasEmpty: true, priorFocusCount: 20 },
  });
  expect(telemetry.snapshot().focusCount).toBe(21);
});

test.each<PointerControlType>(["button", "radio", "checkbox"])(
  "%s measures only retained clicks and keeps counting after its cap",
  (kind) => {
    render({ kind, onSnapshot: receive });
    pointer(target());
    expectNoGeometry();
    pointer(target(), "pointerup");
    click(target());
    expect(geometry()).toHaveBeenCalled();
    if (kind !== "button") expect(textGeometry()).toHaveBeenCalled();
    for (let i = 0; i < 19; i++) physicalClick(target());
    const earlier = telemetry.snapshot();
    clearGeometry();
    physicalClick(target(), "pen");
    expectNoGeometry();
    expect(telemetry.snapshot()).toMatchObject({
      clickCount: 21,
      clickCountsBySource: { pointer: 21, keyboard: 0, unknown: 0 },
      clickCountsByPointerType: { mouse: 20, touch: 0, pen: 1, unknown: 0 },
      clickSamples: earlier.clickSamples,
      focusCount: 0,
    });
  },
);
