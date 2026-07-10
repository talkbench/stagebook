// @vitest-environment jsdom
import { describe, test, expect, vi, beforeAll } from "vitest";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { TimeScrubber, type TimeScrubberHandle } from "./TimeScrubber.js";
import type { ViewerStep } from "../lib/steps.js";

// Unit coverage for the `Alt+K` imperative path added in the hotkeys work: the
// viewer drives play/pause through the ref, and `toggle()` restarts from 0 when
// the scrubber is already at the end. Playwright CT (Viewer.hotkeys.ct.tsx)
// covers the play↔pause round-trip; here we exercise the branch that needs the
// timeline parked at its end, which is awkward to reach through the UI.
//
// jsdom (dev React) also gives this refactored, hook-churned component a
// rules-of-hooks smoke net that prod-React CT can't provide.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

// TimeScrubber reads only `.duration` and `.elements`; cast the rest away.
function step(fields: Partial<ViewerStep>): ViewerStep {
  return { elements: [], ...fields } as unknown as ViewerStep;
}

function mount(currentStep: ViewerStep, elapsedTime: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = createRef<TimeScrubberHandle>();
  const onTimeChange = vi.fn();
  act(() =>
    root.render(
      <TimeScrubber
        ref={ref}
        currentStep={currentStep}
        elapsedTime={elapsedTime}
        onTimeChange={onTimeChange}
      />,
    ),
  );
  return {
    ref,
    onTimeChange,
    unmount: () => act(() => root.unmount()),
    cleanup: () => container.remove(),
  };
}

describe("TimeScrubber imperative toggle (Alt+K)", () => {
  test("restarts from 0 when toggled at the end of the timeline", () => {
    const { ref, onTimeChange, unmount, cleanup } = mount(
      step({ duration: 60 }),
      60,
    );
    const handle = ref.current;
    if (!handle) throw new Error("expected a TimeScrubber handle");

    act(() => handle.toggle());
    expect(onTimeChange).toHaveBeenCalledWith(0);

    unmount();
    cleanup();
  });

  test("does not reset when toggled mid-timeline", () => {
    const { ref, onTimeChange, unmount, cleanup } = mount(
      step({ duration: 60 }),
      10,
    );
    const handle = ref.current;
    if (!handle) throw new Error("expected a TimeScrubber handle");

    act(() => handle.toggle());
    expect(onTimeChange).not.toHaveBeenCalled();

    unmount();
    cleanup();
  });

  test("exposes no handle for an untimed step, so Alt+K safely no-ops", () => {
    const { ref, unmount, cleanup } = mount(step({ duration: undefined }), 0);
    expect(ref.current).toBeNull();

    unmount();
    cleanup();
  });
});
