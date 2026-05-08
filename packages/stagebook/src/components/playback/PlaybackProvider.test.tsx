// @vitest-environment jsdom
import { describe, test, expect, vi } from "vitest";
import React, { useMemo, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  PlaybackProvider,
  useRegisterPlayback,
  usePlayback,
} from "./PlaybackProvider.js";
import type { PlaybackHandle } from "./PlaybackHandle.js";

function makeHandle(overrides: Partial<PlaybackHandle> = {}): PlaybackHandle {
  return {
    play: () => {},
    pause: () => {},
    seekTo: () => {},
    getCurrentTime: () => 0,
    getDuration: () => 60,
    isPaused: () => true,
    isYouTube: false,
    channelCount: 0,
    peaks: [],
    peaksVersion: 0,
    durationVersion: 1,
    requestWaveformCapture() {},
    setChannelMuted() {},
    isChannelMuted: () => false,
    ...overrides,
  };
}

describe("PlaybackProvider register/unregister render loop (#103)", () => {
  test("registering a handle does not cause infinite re-render loop", () => {
    const container = document.createElement("div");
    let root: Root;
    let renderCount = 0;

    // A component with a stable handle (via useMemo) that registers it
    // and tracks how many times it renders. If the register/unregister
    // cycle creates a new Map every time, context changes trigger
    // re-renders ad infinitum.
    function Registrar(): ReactNode {
      renderCount++;
      if (renderCount > 50) {
        throw new Error(
          `Render loop detected: Registrar rendered ${renderCount} times`,
        );
      }
      const handle = useMemo(() => makeHandle(), []);
      useRegisterPlayback("player", handle);
      return null;
    }

    // Mounting inside a PlaybackProvider should settle within a few renders.
    // With the bug, register() always creates a new Map even when the
    // handle is already registered, causing context → re-render → effect →
    // register → new Map → context → re-render → ... infinitely.
    expect(() => {
      act(() => {
        root = createRoot(container);
        root.render(
          <PlaybackProvider>
            <Registrar />
          </PlaybackProvider>,
        );
      });
    }).not.toThrow();

    // A stable handle should settle within a small number of renders
    // (initial render + one re-render from registration at most).
    expect(renderCount).toBeLessThanOrEqual(5);

    act(() => root.unmount());
  });

  test("registering a handle with a consumer does not cause infinite re-render loop", () => {
    const container = document.createElement("div");
    let root: Root;
    let registrarRenders = 0;
    const status = { current: "" };

    function Registrar(): ReactNode {
      registrarRenders++;
      if (registrarRenders > 50) {
        throw new Error(
          `Render loop detected: Registrar rendered ${registrarRenders} times`,
        );
      }
      const handle = useMemo(
        () => makeHandle({ getCurrentTime: () => 42 }),
        [],
      );
      useRegisterPlayback("vid", handle);
      return null;
    }

    function Consumer(): ReactNode {
      const handle = usePlayback("vid");
      status.current = handle ? "found" : "not-found";
      return null;
    }

    // Both a registrar and a consumer inside the same provider.
    // This is the scenario described in #103: MediaPlayer registers,
    // and a sibling (e.g. Timeline) consumes the handle.
    expect(() => {
      act(() => {
        root = createRoot(container);
        root.render(
          <PlaybackProvider>
            <Registrar />
            <Consumer />
          </PlaybackProvider>,
        );
      });
    }).not.toThrow();

    expect(status.current).toBe("found");

    act(() => root.unmount());
  });
});

describe("global Space handler (issue #300)", () => {
  // Render PlaybackProvider with a single registered handle and return tools
  // for driving the test: spies on play/pause, an `isPausedRef` to flip the
  // handle's apparent state, and an unmount cleanup.
  function setupWithHandle(initialIsPaused = true) {
    const isPausedRef = { current: initialIsPaused };
    const play = vi.fn(() => {
      isPausedRef.current = false;
    });
    const pause = vi.fn(() => {
      isPausedRef.current = true;
    });
    const handle = makeHandle({
      play,
      pause,
      isPaused: () => isPausedRef.current,
    });

    function Registrar(): ReactNode {
      const stable = useMemo(() => handle, []);
      useRegisterPlayback("player", stable);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <PlaybackProvider>
          <Registrar />
        </PlaybackProvider>,
      );
    });

    return {
      play,
      pause,
      isPausedRef,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  function dispatchSpaceOn(
    target: EventTarget,
    init: KeyboardEventInit = {},
  ): KeyboardEvent {
    const e = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(e);
    return e;
  }

  test("Space on document body toggles the registered handle and prevents default", () => {
    const { play, pause, cleanup } = setupWithHandle(true);
    try {
      const e = dispatchSpaceOn(document.body);
      expect(play).toHaveBeenCalledTimes(1);
      expect(pause).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("a second Space pauses when the handle is now playing", () => {
    const { play, pause, cleanup } = setupWithHandle(true);
    try {
      dispatchSpaceOn(document.body); // play
      dispatchSpaceOn(document.body); // pause
      expect(play).toHaveBeenCalledTimes(1);
      expect(pause).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test("does nothing when no handle is registered", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(<PlaybackProvider>{null}</PlaybackProvider>);
    });
    try {
      const e = dispatchSpaceOn(document.body);
      // No handle → no preventDefault, browser keeps its default scroll.
      expect(e.defaultPrevented).toBe(false);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  test("ignores Space typed inside a text input", () => {
    const { play, pause, cleanup } = setupWithHandle(true);
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    try {
      const e = dispatchSpaceOn(input);
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    } finally {
      input.remove();
      cleanup();
    }
  });

  test("ignores Space typed inside a textarea", () => {
    const { play, cleanup } = setupWithHandle(true);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    try {
      const e = dispatchSpaceOn(textarea);
      expect(play).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    } finally {
      textarea.remove();
      cleanup();
    }
  });

  test("ignores Space inside a contenteditable element", () => {
    const { play, cleanup } = setupWithHandle(true);
    const editable = document.createElement("div");
    // jsdom's `.contentEditable = "true"` setter doesn't write the attribute,
    // so set it directly to keep the assertion realistic for real browsers.
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    try {
      const e = dispatchSpaceOn(editable);
      expect(play).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    } finally {
      editable.remove();
      cleanup();
    }
  });

  test("ignores Space combined with a modifier key (shortcut)", () => {
    const { play, pause, cleanup } = setupWithHandle(true);
    try {
      dispatchSpaceOn(document.body, { ctrlKey: true });
      dispatchSpaceOn(document.body, { metaKey: true });
      dispatchSpaceOn(document.body, { altKey: true });
      dispatchSpaceOn(document.body, { shiftKey: true });
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  test("skips when an inner handler already prevented default (no double-toggle)", () => {
    const { play, pause, cleanup } = setupWithHandle(true);
    try {
      const inner = (e: Event) => {
        e.preventDefault();
      };
      document.body.addEventListener("keydown", inner);
      try {
        dispatchSpaceOn(document.body);
      } finally {
        document.body.removeEventListener("keydown", inner);
      }
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  test("only the most recently registered handle is toggled", () => {
    const isPausedA = { current: true };
    const playA = vi.fn(() => {
      isPausedA.current = false;
    });
    const pauseA = vi.fn(() => {
      isPausedA.current = true;
    });
    const handleA = makeHandle({
      play: playA,
      pause: pauseA,
      isPaused: () => isPausedA.current,
    });

    const isPausedB = { current: true };
    const playB = vi.fn(() => {
      isPausedB.current = false;
    });
    const pauseB = vi.fn(() => {
      isPausedB.current = true;
    });
    const handleB = makeHandle({
      play: playB,
      pause: pauseB,
      isPaused: () => isPausedB.current,
    });

    function Registrar(): ReactNode {
      const a = useMemo(() => handleA, []);
      const b = useMemo(() => handleB, []);
      useRegisterPlayback("a", a);
      useRegisterPlayback("b", b);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <PlaybackProvider>
          <Registrar />
        </PlaybackProvider>,
      );
    });
    try {
      dispatchSpaceOn(document.body);
      // Most-recent (b) toggled; a untouched.
      expect(playB).toHaveBeenCalledTimes(1);
      expect(playA).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
