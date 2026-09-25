import { describe, it, expect } from "vitest";
import {
  computeViewportAfterZoom,
  computeViewportAfterScroll,
  computeViewportAfterSeek,
  computeViewportAfterFocalZoom,
  computeViewportAfterPan,
  clampViewportStart,
  isPlayheadPastThreshold,
  normalizeWheelDelta,
  pinchZoom,
  zoomIn,
  zoomOut,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./viewport.js";

// The whole of a 60 s file, as the Timeline sees a player without a window.
const FILE = { start: 0, end: 60 };
const EMPTY = { start: 0, end: 0 };

describe("clampViewportStart", () => {
  it("never goes below 0", () => {
    expect(clampViewportStart(-5, FILE, 1)).toBe(0);
  });

  it("never lets the viewport extend past duration", () => {
    // At zoom 2, visible duration = 30. So max start = 60 - 30 = 30.
    expect(clampViewportStart(50, FILE, 2)).toBe(30);
  });

  it("returns input if within bounds", () => {
    expect(clampViewportStart(10, FILE, 2)).toBe(10);
  });

  it("clamps to 0 at zoom 1 (full duration visible)", () => {
    expect(clampViewportStart(20, FILE, 1)).toBe(0);
  });
});

describe("computeViewportAfterZoom", () => {
  it("centers on playhead when zooming in", () => {
    // Zoom in from level 1 to level 2 with playhead at 30s, duration 60s
    // Visible duration goes from 60 to 30. Centered on 30 → start = 30 - 15 = 15
    const result = computeViewportAfterZoom({
      currentZoom: 1,
      newZoom: 2,
      domain: FILE,
      currentViewportStart: 0,
      playheadTime: 30,
    });
    expect(result).toBe(15);
  });

  it("clamps when playhead is near the end", () => {
    // Playhead near end, zoom 2 → centering would put start past max
    const result = computeViewportAfterZoom({
      currentZoom: 1,
      newZoom: 2,
      domain: FILE,
      currentViewportStart: 0,
      playheadTime: 55,
    });
    // Visible duration = 30. Centered on 55 = start 40. Max = 60 - 30 = 30. Clamp to 30.
    expect(result).toBe(30);
  });

  it("clamps when playhead is near the start", () => {
    const result = computeViewportAfterZoom({
      currentZoom: 1,
      newZoom: 2,
      domain: FILE,
      currentViewportStart: 0,
      playheadTime: 5,
    });
    // Visible = 30, centered on 5 = start -10. Clamp to 0.
    expect(result).toBe(0);
  });

  it("uses viewport center when playhead is off-screen", () => {
    // Zoom 2, viewport [10, 40]. Playhead at 50 (off-screen).
    // Use viewport center (25) instead. Zooming to 4 → visible 15, centered on 25 = start 17.5
    const result = computeViewportAfterZoom({
      currentZoom: 2,
      newZoom: 4,
      domain: FILE,
      currentViewportStart: 10,
      playheadTime: 50, // off-screen (viewport ends at 40)
    });
    expect(result).toBe(17.5);
  });

  it("returns 0 when zooming out to level 1", () => {
    expect(
      computeViewportAfterZoom({
        currentZoom: 4,
        newZoom: 1,
        domain: FILE,
        currentViewportStart: 30,
        playheadTime: 35,
      }),
    ).toBe(0);
  });
});

describe("zoomIn / zoomOut", () => {
  it("zoomIn doubles", () => {
    expect(zoomIn(1)).toBe(2);
    expect(zoomIn(2)).toBe(4);
  });

  it("zoomOut halves", () => {
    expect(zoomOut(2)).toBe(1);
    expect(zoomOut(4)).toBe(2);
  });

  it("zoomOut never goes below MIN_ZOOM", () => {
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  it("zoomIn caps at a reasonable maximum (e.g., 32)", () => {
    expect(zoomIn(32)).toBe(32);
  });
});

describe("isPlayheadPastThreshold", () => {
  it("returns false when playhead is within first 90% of viewport", () => {
    // Viewport [10, 40], playhead at 25 (50% of viewport)
    expect(isPlayheadPastThreshold(25, 10, 30, 0.9)).toBe(false);
  });

  it("returns true when playhead is past 90% of viewport", () => {
    // Viewport [10, 40], playhead at 38 (93% of viewport)
    expect(isPlayheadPastThreshold(38, 10, 30, 0.9)).toBe(true);
  });

  it("returns true when playhead is at exactly 90%", () => {
    // 10 + 30*0.9 = 37
    expect(isPlayheadPastThreshold(37, 10, 30, 0.9)).toBe(true);
  });
});

describe("computeViewportAfterScroll", () => {
  it("keeps playhead pinned at threshold position", () => {
    // Playhead at 38, viewport [10, 40], threshold 0.9
    // We want playhead at 90% of viewport: viewportStart + visibleDuration*0.9 = playheadTime
    // → viewportStart = playheadTime - visibleDuration*0.9 = 38 - 27 = 11
    const result = computeViewportAfterScroll(38, 30, FILE, 0.9);
    expect(result).toBe(11);
  });

  it("clamps to duration boundary", () => {
    // Near end, large viewport: would scroll past duration
    const result = computeViewportAfterScroll(58, 30, FILE, 0.9);
    // playhead - 30*0.9 = 58 - 27 = 31. Max = 60 - 30 = 30. Clamp to 30.
    expect(result).toBe(30);
  });
});

describe("computeViewportAfterSeek", () => {
  it("snaps viewport so playhead is at ~25% from left", () => {
    // Playhead at 30, visible 20, duration 60, snap target 0.25
    // → start = 30 - 20*0.25 = 25 (within bounds: max = 60-20 = 40)
    const result = computeViewportAfterSeek(30, 20, FILE, 0.25);
    expect(result).toBeCloseTo(25, 5);
  });

  it("clamps to 0", () => {
    // Playhead at 5, visible 30, snap 0.25 → start = -2.5. Clamp to 0.
    const result = computeViewportAfterSeek(5, 30, FILE, 0.25);
    expect(result).toBe(0);
  });

  it("clamps to max", () => {
    // Playhead at 58, visible 30, snap 0.25 → start = 50.5. Max = 60 - 30 = 30. Clamp to 30.
    const result = computeViewportAfterSeek(58, 30, FILE, 0.25);
    expect(result).toBe(30);
  });
});

describe("pinchZoom", () => {
  it("returns the input zoom for deltaY = 0", () => {
    expect(pinchZoom(2, 0)).toBe(2);
  });

  it("zooms in for negative deltaY (pinch out / two-finger swipe up)", () => {
    expect(pinchZoom(2, -100)).toBeGreaterThan(2);
  });

  it("zooms out for positive deltaY (pinch in / two-finger swipe down)", () => {
    expect(pinchZoom(4, 100)).toBeLessThan(4);
  });

  it("compounds multiplicatively across ticks", () => {
    // Two ticks of -50 should equal one tick of -100 (within float tolerance).
    const onceLarge = pinchZoom(2, -100);
    const twiceSmall = pinchZoom(pinchZoom(2, -50), -50);
    expect(twiceSmall).toBeCloseTo(onceLarge, 5);
  });

  it("clamps at MIN_ZOOM", () => {
    expect(pinchZoom(MIN_ZOOM, 1000)).toBe(MIN_ZOOM);
  });

  it("clamps at MAX_ZOOM", () => {
    expect(pinchZoom(MAX_ZOOM, -1000)).toBe(MAX_ZOOM);
  });

  it("clamps at MAX_ZOOM even when the multiplicative factor overflows", () => {
    // exp(-(-100000) * 0.01) = exp(1000) overflows to Infinity. We rely on
    // Math.min(MAX_ZOOM, Infinity) === MAX_ZOOM rather than bailing out,
    // since the user's intent (huge pinch-in) is unambiguously "max zoom."
    expect(pinchZoom(1, -100000)).toBe(MAX_ZOOM);
  });

  it("returns input on non-finite deltaY", () => {
    expect(pinchZoom(2, Number.NaN)).toBe(2);
    expect(pinchZoom(2, Number.POSITIVE_INFINITY)).toBe(2);
  });
});

describe("computeViewportAfterFocalZoom", () => {
  it("keeps focalTime under focalRatio after zoom", () => {
    // Focal at 30s, want it to stay at 50% of viewport at zoom 4.
    // visible = 60/4 = 15, so start = 30 - 15*0.5 = 22.5.
    const result = computeViewportAfterFocalZoom({
      newZoom: 4,
      domain: FILE,
      focalTime: 30,
      focalRatio: 0.5,
    });
    expect(result).toBeCloseTo(22.5, 5);
  });

  it("anchors to the left edge when focalRatio is 0", () => {
    // focalTime should remain at the very left of the viewport.
    const result = computeViewportAfterFocalZoom({
      newZoom: 4,
      domain: FILE,
      focalTime: 20,
      focalRatio: 0,
    });
    expect(result).toBeCloseTo(20, 5);
  });

  it("anchors to the right edge when focalRatio is 1", () => {
    // visible = 15. start = 45 - 15 = 30.
    const result = computeViewportAfterFocalZoom({
      newZoom: 4,
      domain: FILE,
      focalTime: 45,
      focalRatio: 1,
    });
    expect(result).toBeCloseTo(30, 5);
  });

  it("clamps to 0 when zooming would push viewport before t=0", () => {
    // Focal near start, zoom would put start = 5 - 30*0.5 = -10 → clamp 0.
    const result = computeViewportAfterFocalZoom({
      newZoom: 2,
      domain: FILE,
      focalTime: 5,
      focalRatio: 0.5,
    });
    expect(result).toBe(0);
  });

  it("clamps to max when zooming would push viewport past duration", () => {
    // Focal near end. visible = 30, max start = 30. Should clamp.
    const result = computeViewportAfterFocalZoom({
      newZoom: 2,
      domain: FILE,
      focalTime: 58,
      focalRatio: 0.1,
    });
    expect(result).toBe(30);
  });

  it("returns 0 at zoom <= 1 (full duration visible)", () => {
    expect(
      computeViewportAfterFocalZoom({
        newZoom: 1,
        domain: FILE,
        focalTime: 30,
        focalRatio: 0.5,
      }),
    ).toBe(0);
  });

  it("returns the domain start for an empty domain", () => {
    expect(
      computeViewportAfterFocalZoom({
        newZoom: 4,
        domain: EMPTY,
        focalTime: 30,
        focalRatio: 0.5,
      }),
    ).toBe(0);
  });
});

describe("computeViewportAfterPan", () => {
  it("pans right (forward in time) on positive deltaPx", () => {
    // 800px shows 30s (zoom 2 of 60s) → 1px = 0.0375s. 100px = 3.75s.
    const result = computeViewportAfterPan({
      currentViewportStart: 0,
      deltaPx: 100,
      waveformWidthPx: 800,
      domain: FILE,
      zoomLevel: 2,
    });
    expect(result).toBeCloseTo(3.75, 5);
  });

  it("pans left (back in time) on negative deltaPx", () => {
    const result = computeViewportAfterPan({
      currentViewportStart: 10,
      deltaPx: -100,
      waveformWidthPx: 800,
      domain: FILE,
      zoomLevel: 2,
    });
    expect(result).toBeCloseTo(6.25, 5);
  });

  it("clamps at the left edge", () => {
    const result = computeViewportAfterPan({
      currentViewportStart: 1,
      deltaPx: -1000,
      waveformWidthPx: 800,
      domain: FILE,
      zoomLevel: 2,
    });
    expect(result).toBe(0);
  });

  it("clamps at the right edge", () => {
    // max start at zoom 2 = 60 - 30 = 30
    const result = computeViewportAfterPan({
      currentViewportStart: 25,
      deltaPx: 10000,
      waveformWidthPx: 800,
      domain: FILE,
      zoomLevel: 2,
    });
    expect(result).toBe(30);
  });

  it("returns currentViewportStart for zero waveform width", () => {
    const result = computeViewportAfterPan({
      currentViewportStart: 5,
      deltaPx: 100,
      waveformWidthPx: 0,
      domain: FILE,
      zoomLevel: 2,
    });
    expect(result).toBe(5);
  });

  it("returns currentViewportStart for an empty domain", () => {
    const result = computeViewportAfterPan({
      currentViewportStart: 5,
      deltaPx: 100,
      waveformWidthPx: 800,
      domain: EMPTY,
      zoomLevel: 2,
    });
    expect(result).toBe(5);
  });
});

describe("a domain that starts after 0 (#675)", () => {
  // A player showing 60–90 s of a longer file.
  const WINDOW = { start: 60, end: 90 };

  it("clampViewportStart keeps the viewport inside the window", () => {
    expect(clampViewportStart(0, WINDOW, 1)).toBe(60);
    expect(clampViewportStart(100, WINDOW, 2)).toBe(75);
    expect(clampViewportStart(70, WINDOW, 2)).toBe(70);
  });

  it("computeViewportAfterZoom returns the window start at zoom 1", () => {
    expect(
      computeViewportAfterZoom({
        currentZoom: 2,
        newZoom: 1,
        domain: WINDOW,
        currentViewportStart: 70,
        playheadTime: 75,
      }),
    ).toBe(60);
  });

  it("computeViewportAfterZoom centers on the playhead in media time", () => {
    // Visible 30 → 15 s; centered on 75 s → start 67.5 s.
    expect(
      computeViewportAfterZoom({
        currentZoom: 1,
        newZoom: 2,
        domain: WINDOW,
        currentViewportStart: 60,
        playheadTime: 75,
      }),
    ).toBe(67.5);
  });

  it("computeViewportAfterSeek and AfterScroll clamp to the window", () => {
    // 62 - 10 * 0.25 = 59.5 → 60.
    expect(computeViewportAfterSeek(62, 10, WINDOW, 0.25)).toBe(60);
    // 89 - 15 * 0.9 = 75.5 → max start 90 - 15 = 75.
    expect(computeViewportAfterScroll(89, 15, WINDOW, 0.9)).toBe(75);
  });

  it("computeViewportAfterFocalZoom clamps to the window", () => {
    expect(
      computeViewportAfterFocalZoom({
        newZoom: 1,
        domain: WINDOW,
        focalTime: 75,
        focalRatio: 0.5,
      }),
    ).toBe(60);
    // 61 - 15 * 0.5 = 53.5 → 60.
    expect(
      computeViewportAfterFocalZoom({
        newZoom: 2,
        domain: WINDOW,
        focalTime: 61,
        focalRatio: 0.5,
      }),
    ).toBe(60);
  });

  it("computeViewportAfterPan clamps to the window", () => {
    const pan = (deltaPx: number) =>
      computeViewportAfterPan({
        currentViewportStart: 65,
        deltaPx,
        waveformWidthPx: 800,
        domain: WINDOW,
        zoomLevel: 2,
      });
    expect(pan(-10000)).toBe(60);
    expect(pan(10000)).toBe(75);
  });
});

describe("normalizeWheelDelta", () => {
  it("passes pixel-mode deltas through unchanged", () => {
    expect(normalizeWheelDelta(42, 0)).toBe(42);
    expect(normalizeWheelDelta(-7.5, 0)).toBe(-7.5);
  });

  it("scales line-mode deltas to pixels", () => {
    // Mode 1 (DOM_DELTA_LINE): one line ≈ 16px.
    expect(normalizeWheelDelta(3, 1)).toBe(48);
    expect(normalizeWheelDelta(-1, 1)).toBe(-16);
  });

  it("scales page-mode deltas to pixels", () => {
    // Mode 2 (DOM_DELTA_PAGE): one page ≈ 800px.
    expect(normalizeWheelDelta(1, 2)).toBe(800);
    expect(normalizeWheelDelta(-2, 2)).toBe(-1600);
  });

  it("returns 0 on non-finite delta", () => {
    expect(normalizeWheelDelta(Number.NaN, 0)).toBe(0);
    expect(normalizeWheelDelta(Number.POSITIVE_INFINITY, 1)).toBe(0);
  });

  it("falls through to pass-through for unknown deltaMode", () => {
    expect(normalizeWheelDelta(5, 99)).toBe(5);
  });
});
