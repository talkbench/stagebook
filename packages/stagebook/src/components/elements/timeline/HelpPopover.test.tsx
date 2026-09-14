// @vitest-environment jsdom
import { describe, test, expect, vi } from "vitest";
import React, { type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HelpPopover } from "./HelpPopover.js";

function createButtonRef() {
  const button = document.createElement("button");
  button.getBoundingClientRect = () => ({
    top: 100,
    right: 200,
    bottom: 124,
    left: 176,
    width: 24,
    height: 24,
    x: 176,
    y: 100,
    toJSON: () => ({}),
  });
  document.body.appendChild(button);
  return { button, ref: { current: button } };
}

function installDocumentListenerSpy() {
  const addSpy = vi.spyOn(document, "addEventListener");
  const removeSpy = vi.spyOn(document, "removeEventListener");
  return {
    addCalls: (type: string) =>
      addSpy.mock.calls.filter(([t]) => t === type).length,
    removeCalls: (type: string) =>
      removeSpy.mock.calls.filter(([t]) => t === type).length,
    restore: () => {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    },
  };
}

describe("HelpPopover — unstable callback audit (#105)", () => {
  test("does not churn document listeners when onClose is unstable", () => {
    const spy = installDocumentListenerSpy();
    const { button, ref } = createButtonRef();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;

    function Parent({ tick }: { tick: number }): ReactNode {
      void tick;
      // Fresh inline onClose every render
      return (
        <HelpPopover selectionType="range" onClose={() => {}} buttonRef={ref} />
      );
    }

    act(() => {
      root = createRoot(container);
      root.render(<Parent tick={0} />);
    });

    const keyAddsAfterMount = spy.addCalls("keydown");
    const mouseAddsAfterMount = spy.addCalls("mousedown");

    for (let i = 1; i <= 5; i++) {
      act(() => {
        root.render(<Parent tick={i} />);
      });
    }

    // No re-registration should occur from onClose identity changes
    expect(spy.addCalls("keydown")).toBe(keyAddsAfterMount);
    expect(spy.addCalls("mousedown")).toBe(mouseAddsAfterMount);
    expect(spy.removeCalls("keydown")).toBe(0);
    expect(spy.removeCalls("mousedown")).toBe(0);

    act(() => root.unmount());
    document.body.removeChild(container);
    document.body.removeChild(button);
    spy.restore();
  });

  test("Escape invokes the latest onClose after re-render", () => {
    const { button, ref } = createButtonRef();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    const onCloseV1 = vi.fn();
    const onCloseV2 = vi.fn();

    function Parent({ onClose }: { onClose: () => void }): ReactNode {
      return (
        <HelpPopover selectionType="range" onClose={onClose} buttonRef={ref} />
      );
    }

    act(() => {
      root = createRoot(container);
      root.render(<Parent onClose={onCloseV1} />);
    });

    act(() => {
      root.render(<Parent onClose={onCloseV2} />);
    });

    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onCloseV1).not.toHaveBeenCalled();
    expect(onCloseV2).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    document.body.removeChild(container);
    document.body.removeChild(button);
  });

  test("renders popover into document.body via portal", () => {
    const { button, ref } = createButtonRef();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;

    act(() => {
      root = createRoot(container);
      root.render(
        <HelpPopover
          selectionType="range"
          onClose={() => {}}
          buttonRef={ref}
        />,
      );
    });

    // The popover should be rendered into document.body, not inside the container
    const popover = document.querySelector(
      '[data-testid="timeline-help-popover"]',
    );
    expect(popover).not.toBeNull();
    expect(container.contains(popover)).toBe(false);
    expect(document.body.contains(popover)).toBe(true);

    // Check that position is fixed
    const style = (popover as HTMLElement).style;
    expect(style.position).toBe("fixed");

    act(() => root.unmount());
    document.body.removeChild(container);
    document.body.removeChild(button);
  });
});
