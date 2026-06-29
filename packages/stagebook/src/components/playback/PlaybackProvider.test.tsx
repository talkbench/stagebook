// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
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

describe("useRegisterPlayback null handle (#487)", () => {
  test("a null handle registers nothing; switching null→handle registers it", () => {
    const container = document.createElement("div");
    let root: Root;
    const seen: string[] = [];

    function Registrar({ live }: { live: boolean }): ReactNode {
      // A would-be handle, only registered once `live`. Mirrors MediaPlayer
      // passing null while the URL is unsafe, then the real handle on recovery.
      const handle = useMemo(() => makeHandle({ getCurrentTime: () => 7 }), []);
      useRegisterPlayback("vid", live ? handle : null);
      return null;
    }

    function Consumer(): ReactNode {
      const handle = usePlayback("vid");
      seen.push(handle ? "found" : "not-found");
      return null;
    }

    act(() => {
      root = createRoot(container);
      root.render(
        <PlaybackProvider>
          <Registrar live={false} />
          <Consumer />
        </PlaybackProvider>,
      );
    });
    // No handle registered while null.
    expect(seen.at(-1)).toBe("not-found");

    // Flip to a real handle — the consumer now sees it (undefined→handle),
    // which is exactly the transition a Timeline keys its waveform retry on.
    act(() => {
      root.render(
        <PlaybackProvider>
          <Registrar live={true} />
          <Consumer />
        </PlaybackProvider>,
      );
    });
    expect(seen.at(-1)).toBe("found");

    act(() => root.unmount());
  });
});
