// Pure viewport math for the Timeline. Zoom level + viewport start handling,
// auto-scroll threshold, seek snap, etc. No React/DOM deps.
//
// Times are media seconds. The domain is the span the Timeline shows at
// zoom 1 — the whole file, or the source player's window (#675) — so the
// viewport never starts before `domain.start` or ends after `domain.end`.
import { domainSpan, type TimeDomain } from "./domain.js";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 32;

/** Default fraction of viewport width at which auto-scroll begins. */
export const AUTO_SCROLL_THRESHOLD = 0.9;

/** Where the playhead lands within the viewport after a seek snap (0..1). */
export const SEEK_SNAP_POSITION = 0.25;

/**
 * Minimum delta (seconds) between RAF ticks that counts as a "seek jump"
 * rather than continuous playback. When the playhead moves by more than
 * this in a single tick, the viewport snaps rather than scrolling smoothly.
 *
 * At normal 1x playback with 60fps RAF, each tick is ~0.017s. At 2x it's
 * ~0.033s. A threshold of 1.5s provides a wide margin above both while
 * still catching all scrub-bar and keyboard seeks (which move 1s+ at once).
 */
export const SEEK_JUMP_THRESHOLD = 1.5;

/**
 * Clamp viewport start so the visible region stays inside the domain.
 */
export function clampViewportStart(
  start: number,
  domain: TimeDomain,
  zoomLevel: number,
): number {
  const visibleDuration = domainSpan(domain) / zoomLevel;
  const max = Math.max(domain.start, domain.end - visibleDuration);
  if (start < domain.start) return domain.start;
  if (start > max) return max;
  return start;
}

/**
 * Double the zoom level, capped at MAX_ZOOM.
 */
export function zoomIn(currentZoom: number): number {
  return Math.min(currentZoom * 2, MAX_ZOOM);
}

/**
 * Halve the zoom level, capped at MIN_ZOOM.
 */
export function zoomOut(currentZoom: number): number {
  return Math.max(currentZoom / 2, MIN_ZOOM);
}

interface ZoomViewportArgs {
  currentZoom: number;
  newZoom: number;
  domain: TimeDomain;
  currentViewportStart: number;
  playheadTime: number;
}

/**
 * Compute the new viewport start after zooming. Centers on the playhead
 * if it's within the current viewport, otherwise centers on the viewport
 * midpoint. Clamps to valid range.
 */
export function computeViewportAfterZoom(args: ZoomViewportArgs): number {
  const { currentZoom, newZoom, domain, currentViewportStart, playheadTime } =
    args;

  if (newZoom <= 1) return domain.start;

  const currentVisible = domainSpan(domain) / currentZoom;
  const newVisible = domainSpan(domain) / newZoom;
  const viewportEnd = currentViewportStart + currentVisible;

  // Center on playhead if it's in the current viewport, else viewport center
  const playheadInView =
    playheadTime >= currentViewportStart && playheadTime <= viewportEnd;
  const center = playheadInView
    ? playheadTime
    : currentViewportStart + currentVisible / 2;

  const newStart = center - newVisible / 2;
  return clampViewportStart(newStart, domain, newZoom);
}

/**
 * Returns true if the playhead is at or past the auto-scroll threshold
 * (default 90% of viewport width).
 */
export function isPlayheadPastThreshold(
  playheadTime: number,
  viewportStart: number,
  visibleDuration: number,
  threshold = AUTO_SCROLL_THRESHOLD,
): boolean {
  return playheadTime >= viewportStart + visibleDuration * threshold;
}

/**
 * Compute the new viewport start to keep the playhead pinned at the
 * threshold position (e.g., 90%) during continuous playback.
 */
export function computeViewportAfterScroll(
  playheadTime: number,
  visibleDuration: number,
  domain: TimeDomain,
  threshold = AUTO_SCROLL_THRESHOLD,
): number {
  const newStart = playheadTime - visibleDuration * threshold;
  // Note: using zoomLevel = span / visibleDuration so clamp can compute max
  const zoomLevel = domainSpan(domain) / visibleDuration;
  return clampViewportStart(newStart, domain, zoomLevel);
}

/**
 * Compute the new viewport start to snap the playhead to a target position
 * (e.g., 25% from the left edge) after a seek/scrub.
 */
export function computeViewportAfterSeek(
  playheadTime: number,
  visibleDuration: number,
  domain: TimeDomain,
  snapPosition = SEEK_SNAP_POSITION,
): number {
  const newStart = playheadTime - visibleDuration * snapPosition;
  const zoomLevel = domainSpan(domain) / visibleDuration;
  return clampViewportStart(newStart, domain, zoomLevel);
}

/**
 * Sensitivity (per pixel of wheel deltaY) for ctrl+wheel pinch-to-zoom.
 * Sized so a typical Mac trackpad pinch — which produces deltaY accumulation
 * of ~50–100 over the gesture — zooms by roughly 1.5–3×, matching the feel
 * of native browser pinch.
 */
export const PINCH_ZOOM_SENSITIVITY = 0.01;

/** Approximate line height (px) for converting `DOM_DELTA_LINE` deltas. */
const WHEEL_LINE_PX = 16;
/** Approximate page height (px) for converting `DOM_DELTA_PAGE` deltas. */
const WHEEL_PAGE_PX = 800;

/**
 * Convert a wheel delta to pixels regardless of the event's `deltaMode`.
 * Trackpads always emit `DOM_DELTA_PIXEL` (0), but some mice and rare
 * browser configurations emit `DOM_DELTA_LINE` (1) or `DOM_DELTA_PAGE`
 * (2). Without normalization, our pan/zoom sensitivity is wildly off on
 * those input devices — a single line tick of `dx=3` would feel like 3
 * pixels of pan instead of ~48.
 */
export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * WHEEL_PAGE_PX;
  return delta;
}

/**
 * Apply a single pinch wheel tick to a zoom level. Negative deltaY (pinch
 * out / two-finger swipe up with ctrl) zooms in; positive deltaY zooms out.
 * Multiplicative so successive ticks compound smoothly. Clamped to
 * [MIN_ZOOM, MAX_ZOOM].
 */
export function pinchZoom(currentZoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY)) return currentZoom;
  const factor = Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY);
  const next = currentZoom * factor;
  // Math.min/max with Infinity behaves correctly: huge negative deltaY
  // produces +Infinity, which clamps to MAX_ZOOM; huge positive deltaY
  // produces ~0, which clamps to MIN_ZOOM. NaN can't reach here since
  // deltaY is finite (Math.exp of a finite number is in [0, +Infinity]).
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
}

/**
 * Compute the new viewport start when zooming around a focal point that
 * should stay anchored on screen — e.g., during pinch-to-zoom, the time
 * under the cursor stays under the cursor.
 *
 * @param newZoom - Target zoom level (clamped at MIN_ZOOM internally)
 * @param domain - The span visible at zoom 1, in media seconds
 * @param focalTime - Time (seconds) under the focal point
 * @param focalRatio - Fraction across the viewport (0 = left, 1 = right)
 *                     where focalTime should remain after the zoom
 */
export function computeViewportAfterFocalZoom(args: {
  newZoom: number;
  domain: TimeDomain;
  focalTime: number;
  focalRatio: number;
}): number {
  const { newZoom, domain, focalTime, focalRatio } = args;
  if (newZoom <= 1) return domain.start;
  if (domainSpan(domain) <= 0) return domain.start;
  const newVisible = domainSpan(domain) / newZoom;
  const newStart = focalTime - newVisible * focalRatio;
  return clampViewportStart(newStart, domain, newZoom);
}

/**
 * Compute the new viewport start after a horizontal pan by `deltaPx`
 * pixels. Positive deltaPx pans the viewport to the right (forward in
 * time), matching the convention that wheel deltaX is positive when the
 * user scrolls right.
 */
export function computeViewportAfterPan(args: {
  currentViewportStart: number;
  deltaPx: number;
  waveformWidthPx: number;
  domain: TimeDomain;
  zoomLevel: number;
}): number {
  const { currentViewportStart, deltaPx, waveformWidthPx, domain, zoomLevel } =
    args;
  if (waveformWidthPx <= 0 || domainSpan(domain) <= 0) {
    return currentViewportStart;
  }
  const visibleDuration = domainSpan(domain) / zoomLevel;
  const secondsPerPx = visibleDuration / waveformWidthPx;
  const newStart = currentViewportStart + deltaPx * secondsPerPx;
  return clampViewportStart(newStart, domain, zoomLevel);
}
