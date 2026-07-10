// @vitest-environment jsdom
import { describe, test, expect, vi, beforeAll } from "vitest";
import React, { useRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  dispatchViewerHotkey,
  useViewerHotkeys,
  type ViewerHotkeyHandlers,
} from "./hotkeys.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function makeHandlers(): ViewerHotkeyHandlers & {
  [K in keyof ViewerHotkeyHandlers]: ReturnType<typeof vi.fn>;
} {
  return {
    onPrevStep: vi.fn(),
    onNextStep: vi.fn(),
    onPrevTreatment: vi.fn(),
    onNextTreatment: vi.fn(),
    onSelectPosition: vi.fn(),
    onToggleTimer: vi.fn(),
    onToggleHelp: vi.fn(),
    onFocusPicker: vi.fn(),
  };
}

/** Build a cancelable keydown so `defaultPrevented` reflects preventDefault(). */
function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { cancelable: true, ...init });
}

describe("dispatchViewerHotkey", () => {
  test("Alt+Arrows drive step (←/→) and treatment (↑/↓) navigation", () => {
    const h = makeHandlers();
    dispatchViewerHotkey(key({ altKey: true, code: "ArrowLeft" }), h);
    dispatchViewerHotkey(key({ altKey: true, code: "ArrowRight" }), h);
    dispatchViewerHotkey(key({ altKey: true, code: "ArrowUp" }), h);
    dispatchViewerHotkey(key({ altKey: true, code: "ArrowDown" }), h);
    expect(h.onPrevStep).toHaveBeenCalledTimes(1);
    expect(h.onNextStep).toHaveBeenCalledTimes(1);
    expect(h.onPrevTreatment).toHaveBeenCalledTimes(1);
    expect(h.onNextTreatment).toHaveBeenCalledTimes(1);
  });

  test("Alt+digit selects that player position; 0 maps to position 0", () => {
    const h = makeHandlers();
    dispatchViewerHotkey(key({ altKey: true, code: "Digit3" }), h);
    dispatchViewerHotkey(key({ altKey: true, code: "Digit0" }), h);
    expect(h.onSelectPosition).toHaveBeenNthCalledWith(1, 3);
    expect(h.onSelectPosition).toHaveBeenNthCalledWith(2, 0);
  });

  test("Alt+K toggles the timer, Alt+/ toggles help", () => {
    const h = makeHandlers();
    dispatchViewerHotkey(key({ altKey: true, code: "KeyK" }), h);
    dispatchViewerHotkey(key({ altKey: true, code: "Slash" }), h);
    expect(h.onToggleTimer).toHaveBeenCalledTimes(1);
    expect(h.onToggleHelp).toHaveBeenCalledTimes(1);
  });

  test("Alt+P focuses the part picker", () => {
    const h = makeHandlers();
    const e = key({ altKey: true, code: "KeyP" });
    expect(dispatchViewerHotkey(e, h)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(h.onFocusPicker).toHaveBeenCalledTimes(1);
  });

  test("keys off event.code, so macOS Option-composed event.key is irrelevant", () => {
    const h = makeHandlers();
    // On macOS, Option+K yields event.key "˚" and Option+3 yields "£".
    // Keying off `code` must still route correctly.
    dispatchViewerHotkey(key({ altKey: true, code: "KeyK", key: "˚" }), h);
    dispatchViewerHotkey(key({ altKey: true, code: "Digit3", key: "£" }), h);
    expect(h.onToggleTimer).toHaveBeenCalledTimes(1);
    expect(h.onSelectPosition).toHaveBeenCalledWith(3);
  });

  test("returns true and prevents default on a handled key", () => {
    const h = makeHandlers();
    const e = key({ altKey: true, code: "ArrowRight" });
    expect(dispatchViewerHotkey(e, h)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  test("ignores bare keys (no modifier) — they pass through to the study", () => {
    const h = makeHandlers();
    const e = key({ code: "ArrowRight" });
    expect(dispatchViewerHotkey(e, h)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    expect(h.onNextStep).not.toHaveBeenCalled();
  });

  test("ignores Ctrl+Alt (AltGr) and Cmd+Alt so native/i18n input is untouched", () => {
    const h = makeHandlers();
    const altGr = key({ altKey: true, ctrlKey: true, code: "Digit3" });
    const cmdAlt = key({ altKey: true, metaKey: true, code: "ArrowRight" });
    expect(dispatchViewerHotkey(altGr, h)).toBe(false);
    expect(dispatchViewerHotkey(cmdAlt, h)).toBe(false);
    expect(h.onSelectPosition).not.toHaveBeenCalled();
    expect(h.onNextStep).not.toHaveBeenCalled();
  });

  test("ignores an unmapped Alt+<key> without preventing default", () => {
    const h = makeHandlers();
    const e = key({ altKey: true, code: "KeyG" });
    expect(dispatchViewerHotkey(e, h)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe("useViewerHotkeys", () => {
  function mount(handlers: ViewerHotkeyHandlers) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let node!: HTMLDivElement;
    function Probe() {
      const localRef = useRef<HTMLDivElement>(null);
      const setRef = useViewerHotkeys(handlers);
      return (
        <div
          data-testid="root"
          ref={(el) => {
            localRef.current = el;
            setRef(el);
            if (el) node = el;
          }}
        />
      );
    }
    act(() => root.render(<Probe />));
    return {
      node,
      unmount: () => act(() => root.unmount()),
      cleanup: () => container.remove(),
    };
  }

  test("dispatches hotkeys from keydown events within the scoped node", () => {
    const h = makeHandlers();
    const { node, unmount, cleanup } = mount(h);
    act(() => {
      node.dispatchEvent(
        new KeyboardEvent("keydown", {
          altKey: true,
          code: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(h.onNextStep).toHaveBeenCalledTimes(1);
    unmount();
    cleanup();
  });

  test("detaches the listener on unmount", () => {
    const h = makeHandlers();
    const { node, unmount, cleanup } = mount(h);
    unmount();
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        code: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(h.onNextStep).not.toHaveBeenCalled();
    cleanup();
  });

  // The hook tracks its node in state (not a plain ref) specifically so the
  // listener follows when the viewer swaps its root element (the empty-state ↔
  // normal-render transition). A regression to a plain ref would pass every
  // other test here yet silently break hotkeys after such a swap.
  test("follows a node swap — old node goes quiet, new node fires", () => {
    const h = makeHandlers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let nodeA!: HTMLDivElement;
    let nodeB!: HTMLDivElement;
    // Distinct keys force React to unmount the old div and mount a new one, so
    // the ref receives a genuinely different DOM node (not a reconciled reuse).
    function Probe({ which }: { which: "a" | "b" }) {
      const setRef = useViewerHotkeys(h);
      return which === "a" ? (
        <div
          key="a"
          ref={(el) => {
            setRef(el);
            if (el) nodeA = el;
          }}
        />
      ) : (
        <div
          key="b"
          ref={(el) => {
            setRef(el);
            if (el) nodeB = el;
          }}
        />
      );
    }
    act(() => root.render(<Probe which="a" />));
    act(() => root.render(<Probe which="b" />));
    expect(nodeA).not.toBe(nodeB);

    const fire = (n: HTMLElement) =>
      act(() => {
        n.dispatchEvent(
          new KeyboardEvent("keydown", {
            altKey: true,
            code: "ArrowRight",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    fire(nodeA);
    expect(h.onNextStep).not.toHaveBeenCalled();
    fire(nodeB);
    expect(h.onNextStep).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });

  // Handlers may be a fresh object each render; the hook reads the latest set
  // via a ref, so a re-render with new handlers must route to the new ones
  // (a closure captured at subscribe time would fire the stale set).
  test("uses the latest handlers after a re-render (no stale closure)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let node!: HTMLDivElement;
    function Probe({ handlers }: { handlers: ViewerHotkeyHandlers }) {
      const setRef = useViewerHotkeys(handlers);
      return (
        <div
          ref={(el) => {
            setRef(el);
            if (el) node = el;
          }}
        />
      );
    }
    const first = makeHandlers();
    act(() => root.render(<Probe handlers={first} />));
    const second = makeHandlers();
    act(() => root.render(<Probe handlers={second} />));

    act(() => {
      node.dispatchEvent(
        new KeyboardEvent("keydown", {
          altKey: true,
          code: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(first.onNextStep).not.toHaveBeenCalled();
    expect(second.onNextStep).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});
