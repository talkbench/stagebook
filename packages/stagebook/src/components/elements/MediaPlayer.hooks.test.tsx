// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaPlayer, type MediaPlayerProps } from "./MediaPlayer.js";
import { PlaybackProvider, usePlayback } from "../playback/PlaybackProvider.js";

// A rules-of-hooks violation is reported by React's dev build through
// console.error (and can leave the fiber corrupted), not as a thrown error
// that re-render() would surface. So we detect it by watching console.error.
const HOOK_VIOLATION = /order of Hooks|Rendered (more|fewer) hooks/i;

// Regression for #484: MediaPlayer must call the same hooks on every render
// so a single instance can transition between an invalid/unsafe URL and a
// valid one in place (e.g. editing/refreshing a treatment in the viewer
// preview) without tripping React's rules-of-hooks invariant.
//
// This runs under jsdom, which uses React's development build — unlike the
// Playwright CT bundle (production React), the dev build actually *throws*
// "Rendered more/fewer hooks than during the previous render" when the hook
// count changes between renders. That makes this the test that goes red on
// the pre-fix code, where the unsafe-URL early return sits ahead of the
// useRef/useState/useEffect calls.

const UNSAFE_URL = "javascript:alert(1)";
const SAFE_URL = "https://example.com/clip.mp4";

const noopProps = {
  name: "test",
  save: () => {},
  getElapsedTime: () => 0,
};

function render(root: Root, url: string) {
  act(() => {
    root.render(<MediaPlayer {...noopProps} url={url} />);
  });
}

describe("MediaPlayer hook stability across URL validity changes (#484)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  function hookViolations() {
    return errorSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && HOOK_VIOLATION.test(a)),
    );
  }

  function mount(initialUrl: string) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render(root, initialUrl);
    return { container, root };
  }

  // NOTE: a single test owns the rules-of-hooks assertion on purpose. React's
  // dev build dedupes the "change in the order of Hooks" warning to once per
  // component type per process (didWarnAboutMismatchedHooksForComponent), so a
  // second test re-running the same transition would see no console.error and
  // silently pass even on broken code. Keep the load-bearing checks here; don't
  // add a sibling test that re-asserts hookViolations() for MediaPlayer.
  it("re-renders in place across repeated unsafe↔valid URL toggles without a rules-of-hooks violation", () => {
    const { container, root } = mount(UNSAFE_URL);
    // Unsafe URL renders the invalid-URL alert (no <video>).
    expect(
      container
        .querySelector('[data-testid="mediaPlayer"]')
        ?.getAttribute("role"),
    ).toBe("alert");
    expect(container.querySelector("video")).toBeNull();

    // Toggle the URL in place several times, modelling the viewer's
    // edit/refresh loop. Mounting on the unsafe URL set a clean 2-hook
    // baseline, so the first valid render is the "more hooks than the previous
    // render" path — the direction React's dev build flags — which makes this
    // load-bearing: it fails on the pre-fix code where the guard sat ahead of
    // the hooks. (The valid→unsafe steps are the "fewer hooks" unwind, which
    // React 19 tolerates silently; they're here for realism.)
    for (const url of [SAFE_URL, UNSAFE_URL, SAFE_URL]) {
      render(root, url);
    }
    expect(hookViolations()).toEqual([]);

    // Ends on a valid URL — back to a working player.
    expect(
      container
        .querySelector('[data-testid="mediaPlayer"]')
        ?.getAttribute("role"),
    ).toBe("region");
    expect(container.querySelector("video")).not.toBeNull();
  });
});

// The guard moved below the effects (#484), so each URL-touching effect now
// has to gate itself on the unsafe URL — and recover when the URL becomes
// valid. These cover the side-effects Codex flagged on PR #487.
describe("MediaPlayer effects are gated on URL validity (#487)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  function mount(node: ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(node));
    return container;
  }

  // Holds the URL in state and exposes a setter, so the same MediaPlayer
  // instance re-renders in place when the URL changes.
  let setUrlExternally: ((url: string) => void) | null = null;
  function Harness(
    props: Omit<MediaPlayerProps, "url"> & { initialUrl: string },
  ) {
    const { initialUrl, ...rest } = props;
    const [url, setUrl] = useState(initialUrl);
    setUrlExternally = setUrl;
    return <MediaPlayer {...rest} url={url} />;
  }

  it("does not fetch captions while the media URL is unsafe, then fetches on recovery (P3)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n", {
        status: 200,
      }),
    );
    const captionsURL = "https://example.com/captions.vtt";
    const fetchedCaptions = () =>
      fetchSpy.mock.calls.some((c) => c[0] === captionsURL);

    mount(
      <Harness
        name="t"
        save={() => {}}
        getElapsedTime={() => 0}
        initialUrl={UNSAFE_URL}
        captionsURL={captionsURL}
      />,
    );
    // Rejected media → no caption fetch.
    expect(fetchedCaptions()).toBe(false);

    // Recover to a valid media URL → captions load.
    act(() => setUrlExternally!(SAFE_URL));
    expect(fetchedCaptions()).toBe(true);
  });

  it("registers no playback handle while unsafe, then registers on recovery (P2)", () => {
    const seen: string[] = [];
    function Probe() {
      seen.push(usePlayback("vid") ? "found" : "not-found");
      return null;
    }
    mount(
      <PlaybackProvider>
        <Harness
          name="vid"
          save={() => {}}
          getElapsedTime={() => 0}
          initialUrl={UNSAFE_URL}
        />
        <Probe />
      </PlaybackProvider>,
    );
    // No <video> is mounted for an unsafe URL, so nothing is registered.
    expect(seen.at(-1)).toBe("not-found");

    act(() => setUrlExternally!(SAFE_URL));
    // The recovered player registers its handle (undefined→handle), which is
    // the transition a sibling Timeline keys its waveform retry on.
    expect(seen.at(-1)).toBe("found");
  });

  it("reapplies startAt to the <video> that mounts on recovery (P2)", () => {
    // Intercept currentTime assignments at the prototype level — robust to
    // jsdom not persisting media element state.
    const sets: number[] = [];
    const proto = window.HTMLMediaElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "currentTime");
    Object.defineProperty(proto, "currentTime", {
      configurable: true,
      get: () => sets.at(-1) ?? 0,
      set: (v: number) => sets.push(v),
    });

    try {
      mount(
        <Harness
          name="t"
          save={() => {}}
          getElapsedTime={() => 0}
          initialUrl={UNSAFE_URL}
          startAt={12}
        />,
      );
      // No video while unsafe → no seek applied.
      expect(sets).toEqual([]);

      act(() => setUrlExternally!(SAFE_URL));
      // The recovered <video> is seeked to startAt rather than left at 0.
      expect(sets).toContain(12);
    } finally {
      if (original) Object.defineProperty(proto, "currentTime", original);
    }
  });
});
