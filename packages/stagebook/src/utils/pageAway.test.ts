import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AWAY_LOG_THRESHOLD_MS,
  AWAY_TRIGGERS,
  awayReason,
  readPageState,
  watchPageState,
  type PageDocument,
} from "./pageAway.js";
import * as rootEntry from "../index.js";

const page = (hidden: boolean, focused: boolean) => ({ hidden, focused });

describe("awayReason", () => {
  test("by default, a hidden page is away as hidden", () => {
    expect(awayReason(page(true, false))).toBe("hidden");
  });

  test("by default, a visible page without focus is away as unfocused", () => {
    expect(awayReason(page(false, false))).toBe("unfocused");
  });

  test("a visible, focused page is not away", () => {
    expect(awayReason(page(false, true))).toBeNull();
  });

  test("no triggers never counts as away", () => {
    expect(awayReason(page(true, false), [])).toBeNull();
  });

  test("hidden alone ignores a visible page without focus", () => {
    expect(awayReason(page(true, false), ["hidden"])).toBe("hidden");
    expect(awayReason(page(false, false), ["hidden"])).toBeNull();
    expect(awayReason(page(false, true), ["hidden"])).toBeNull();
  });

  test("unfocused also covers a hidden page, reported as hidden", () => {
    expect(awayReason(page(false, false), ["unfocused"])).toBe("unfocused");
    expect(awayReason(page(true, false), ["unfocused"])).toBe("hidden");
    expect(awayReason(page(false, true), ["unfocused"])).toBeNull();
  });
});

/** A document stand-in whose state and events the test controls. */
function fakeDocument(
  initial: { hidden: boolean; focused: boolean },
  { withWindow = true } = {},
) {
  const state = { ...initial };
  const win = new EventTarget();
  const doc = Object.defineProperties(new EventTarget(), {
    // A getter, so the reading follows `state` (Object.assign would copy a
    // snapshot of the value).
    visibilityState: { get: () => (state.hidden ? "hidden" : "visible") },
    hasFocus: { value: () => state.focused },
    defaultView: { value: withWindow ? win : null },
  }) as EventTarget & PageDocument;
  return { doc, win, state };
}

describe("readPageState", () => {
  test("reads visibility and focus from the document", () => {
    const { doc, state } = fakeDocument({ hidden: false, focused: true });
    expect(readPageState(doc)).toEqual({ hidden: false, focused: true });
    state.hidden = true;
    state.focused = false;
    expect(readPageState(doc)).toEqual({ hidden: true, focused: false });
  });

  test("treats a prerendering page as not hidden", () => {
    const doc = { visibilityState: "prerender", hasFocus: () => false };
    expect(readPageState(doc)).toEqual({ hidden: false, focused: false });
  });
});

describe("watchPageState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("reports the page state on visibilitychange and focus at once", () => {
    const { doc, win, state } = fakeDocument({ hidden: false, focused: true });
    const onChange = vi.fn();
    watchPageState(doc, onChange);

    state.hidden = true;
    state.focused = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).toHaveBeenLastCalledWith(
      { hidden: true, focused: false },
      expect.objectContaining({ type: "visibilitychange" }),
    );

    state.hidden = false;
    state.focused = true;
    win.dispatchEvent(new Event("focus"));
    expect(onChange).toHaveBeenLastCalledWith(
      { hidden: false, focused: true },
      expect.objectContaining({ type: "focus" }),
    );
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test("reads focus a task after blur, not during it", () => {
    const { doc, win, state } = fakeDocument({ hidden: false, focused: true });
    const onChange = vi.fn();
    watchPageState(doc, onChange);

    // Some engines still report focus during the window's blur; others
    // report it lost even when focus moved into a frame on the page.
    state.focused = false;
    win.dispatchEvent(new Event("blur"));
    expect(onChange).not.toHaveBeenCalled();

    // Focus went into an embedded frame, so the page still has it.
    state.focused = true;
    vi.runAllTimers();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(
      { hidden: false, focused: true },
      expect.objectContaining({ type: "blur" }),
    );
  });

  test("a second blur replaces a pending one", () => {
    const { doc, win } = fakeDocument({ hidden: false, focused: false });
    const onChange = vi.fn();
    watchPageState(doc, onChange);
    win.dispatchEvent(new Event("blur"));
    win.dispatchEvent(new Event("blur"));
    vi.runAllTimers();
    expect(onChange).toHaveBeenCalledOnce();
  });

  test("stopping removes the listeners and cancels a pending blur", () => {
    const { doc, win } = fakeDocument({ hidden: false, focused: false });
    const onChange = vi.fn();
    const stop = watchPageState(doc, onChange);
    win.dispatchEvent(new Event("blur"));
    stop();
    vi.runAllTimers();
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("without a window, still reports visibility changes", () => {
    const { doc } = fakeDocument(
      { hidden: false, focused: true },
      { withWindow: false },
    );
    const onChange = vi.fn();
    const stop = watchPageState(doc, onChange);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).toHaveBeenCalledOnce();
    stop();
  });
});

describe("shared constants", () => {
  test("names the two ways of being away", () => {
    expect(AWAY_TRIGGERS).toEqual(["hidden", "unfocused"]);
  });

  test("logs absences of a second or more", () => {
    expect(AWAY_LOG_THRESHOLD_MS).toBe(1000);
  });
});

describe("root entry point", () => {
  test("exports the shared away definition", () => {
    expect(rootEntry.awayReason).toBe(awayReason);
    expect(rootEntry.readPageState).toBe(readPageState);
    expect(rootEntry.watchPageState).toBe(watchPageState);
    expect(rootEntry.AWAY_TRIGGERS).toBe(AWAY_TRIGGERS);
    expect(rootEntry.AWAY_LOG_THRESHOLD_MS).toBe(AWAY_LOG_THRESHOLD_MS);
  });
});
