// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaPlayer } from "./MediaPlayer.js";

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
