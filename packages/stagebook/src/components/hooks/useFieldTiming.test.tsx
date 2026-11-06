// @vitest-environment jsdom
import React, { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useFieldTiming } from "./useFieldTiming.js";

let root: Root;
let dom: HTMLDivElement;
let monotonic: number;
let timing: ReturnType<typeof useFieldTiming>;
const stageClock = vi.fn<() => number>();
function Harness({
  getElapsedTime,
  autoFocus,
}: {
  getElapsedTime?: () => number;
  autoFocus?: boolean;
}) {
  timing = useFieldTiming(getElapsedTime);
  return <input autoFocus={autoFocus} onFocus={timing.onFocus} />;
}
function ReplayHarness() {
  useLayoutEffect(
    () => () => {
      monotonic += 500;
    },
    [],
  );
  return <Harness getElapsedTime={stageClock} />;
}
const render = (clock: (() => number) | undefined = stageClock, key = "one") =>
  act(() => root.render(<Harness key={key} getElapsedTime={clock} />));
const focus = () => act(() => dom.querySelector("input")!.focus());
const blur = () => act(() => dom.querySelector("input")!.blur());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  monotonic = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  stageClock.mockReset().mockReturnValue(31.25);
  dom = document.createElement("div");
  document.body.appendChild(dom);
  root = createRoot(dom);
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("latency starts at mount; stage alignment is captured at first focus only", () => {
  render();
  const initial = timing.snapshot();
  expect(initial).toEqual({
    version: 1,
    firstFocusDelayMs: null,
    firstFocusStageTimeElapsed: null,
  });
  expect(stageClock).not.toHaveBeenCalled();
  monotonic = 2250;
  focus();
  expect(timing.snapshot()).toEqual({
    version: 1,
    firstFocusDelayMs: 1250,
    firstFocusStageTimeElapsed: 31.25,
  });
  expect(initial.firstFocusDelayMs).toBeNull();
  stageClock.mockReturnValue(50);
  monotonic = 5000;
  blur();
  focus();
  expect(timing.snapshot().firstFocusStageTimeElapsed).toBe(31.25);
  expect(stageClock).toHaveBeenCalledTimes(1);
});

test("latency does not use the wall clock or subtract stage-clock readings", () => {
  vi.spyOn(Date, "now").mockReturnValue(100000);
  render();
  vi.mocked(Date.now).mockReturnValue(1);
  stageClock.mockReturnValue(0);
  monotonic += 1500;
  focus();
  expect(timing.snapshot()).toMatchObject({
    firstFocusDelayMs: 1500,
    firstFocusStageTimeElapsed: 0,
  });
});

test.each([NaN, Infinity, -1])(
  "an invalid first-focus clock (%s) stays unknown on later focuses",
  (invalid) => {
    stageClock.mockReturnValue(invalid);
    render();
    monotonic += 50;
    focus();
    stageClock.mockReturnValue(20);
    blur();
    focus();
    expect(timing.snapshot()).toMatchObject({
      firstFocusDelayMs: 50,
      firstFocusStageTimeElapsed: null,
    });
    expect(stageClock).toHaveBeenCalledTimes(1);
  },
);

test("a throwing optional clock cannot disrupt focus", () => {
  stageClock.mockImplementation(() => {
    throw new Error("clock unavailable");
  });
  render();
  monotonic += 10;
  expect(focus).not.toThrow();
  expect(timing.snapshot()).toMatchObject({
    firstFocusDelayMs: 10,
    firstFocusStageTimeElapsed: null,
  });
});

test("standalone use without a clock still measures latency", () => {
  act(() => root.render(<Harness key="one" />));
  monotonic += 200;
  focus();
  expect(timing.snapshot()).toMatchObject({
    firstFocusDelayMs: 200,
    firstFocusStageTimeElapsed: null,
  });
  render(stageClock);
  blur();
  focus();
  expect(timing.snapshot().firstFocusStageTimeElapsed).toBeNull();
});

test("a rerender uses the latest callback without resetting the mount origin", () => {
  render();
  monotonic += 200;
  const currentClock = vi.fn(() => 90);
  render(currentClock);
  monotonic += 100;
  focus();
  expect(timing.snapshot()).toMatchObject({
    firstFocusDelayMs: 300,
    firstFocusStageTimeElapsed: 90,
  });
  expect(stageClock).not.toHaveBeenCalled();
});

test("snapshots are detached and a real remount starts a new lifetime", () => {
  render();
  monotonic += 100;
  focus();
  const snapshot = timing.snapshot();
  snapshot.firstFocusDelayMs = 999;
  expect(timing.snapshot().firstFocusDelayMs).toBe(100);
  monotonic += 1000;
  render(stageClock, "two");
  expect(timing.snapshot().firstFocusDelayMs).toBeNull();
  monotonic += 200;
  focus();
  expect(timing.snapshot().firstFocusDelayMs).toBe(200);
});

test("StrictMode effect replay preserves the original mount observation", () => {
  act(() =>
    root.render(
      <StrictMode>
        <ReplayHarness />
      </StrictMode>,
    ),
  );
  monotonic = 2000;
  focus();
  expect(timing.snapshot().firstFocusDelayMs).toBe(1000);
});

test("retained focus callbacks cannot observe events after unmount", () => {
  render();
  const retained = timing;
  act(() => root.render(null));
  retained.onFocus();
  expect(retained.snapshot().firstFocusStageTimeElapsed).toBeNull();
  expect(stageClock).not.toHaveBeenCalled();
});

test("focus before layout records its stage time without inventing a mount latency", () => {
  act(() => root.render(<Harness autoFocus getElapsedTime={stageClock} />));
  expect(document.activeElement).toBe(dom.querySelector("input"));
  expect(timing.snapshot()).toEqual({
    version: 1,
    firstFocusDelayMs: null,
    firstFocusStageTimeElapsed: 31.25,
  });
  monotonic += 1000;
  blur();
  focus();
  expect(timing.snapshot().firstFocusDelayMs).toBeNull();
  expect(stageClock).toHaveBeenCalledTimes(1);
});
