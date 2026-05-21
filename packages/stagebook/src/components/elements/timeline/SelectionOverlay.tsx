import React, { useCallback, useRef, useState } from "react";
import { pixelToTime, timeToPixel } from "./timelineLayout.js";
import { clampToFreeGap } from "./selections.js";
import type { RangeSelection, TimelineValue } from "./selections.js";
import { formatTime } from "../../../utils/formatTime.js";
import { zoomDecimals, handleTooltipStyle } from "./timelineStyles.js";

export interface SelectionOverlayProps {
  /** Width of the waveform area in pixels (excludes gutter). */
  width: number;
  /** Height of the overlay in pixels (covers all tracks). */
  height: number;
  /** Total media duration in seconds. */
  duration: number;
  /** Current zoom level (1 = full duration visible). */
  zoomLevel: number;
  /** Left edge of the visible region in seconds. */
  viewportStart: number;
  /** Selection type. */
  selectionType: "range" | "point";
  /** Selection scope. */
  selectionScope: "track" | "all";
  /** Number of tracks (for track-mode hit testing). */
  channelCount: number;
  /** Whether multiple selections are allowed. When false (single-select),
   *  any "create" gesture (click, drag, Enter) is a no-op once a range
   *  exists; the user must explicitly delete to replace. */
  multiSelect: boolean;
  /** Current selections from reducer state. */
  selections: TimelineValue;
  /** Index of the active/focused selection. */
  activeIndex: number | null;
  /** Active handle in range mode. */
  activeHandle: "start" | "end" | null;

  // ── Callbacks (Timeline.tsx wires these to dispatch + seek) ──
  onSeek: (time: number) => void;
  onCreateRange: (
    start: number,
    end: number,
    track: number | undefined,
  ) => void;
  onCreatePoint: (time: number, track: number | undefined) => void;
  /**
   * `noSnapshot=true` skips the undo snapshot — used for live drag
   * pointermove events so the entire drag collapses into one undo step.
   */
  onAdjustHandle: (
    index: number,
    handle: "start" | "end",
    time: number,
    noSnapshot?: boolean,
  ) => void;
  onRepositionPoint: (
    index: number,
    time: number,
    noSnapshot?: boolean,
  ) => void;
  onSelect: (index: number) => void;
  onDeselect: () => void;
  onSetActiveHandle: (handle: "start" | "end" | null) => void;
  /** Begin a drag transaction — pushes one undo snapshot, defers saves. */
  onBeginDrag: () => void;
  /** End a drag transaction — releases the save defer. */
  onEndDrag: () => void;
  /** Request the parent to focus its keyboard-event container. Called after
   *  selection actions so keyboard shortcuts (arrows, Tab, Delete, Escape)
   *  work immediately without the user manually clicking the timeline. */
  onRequestFocus: () => void;
  /** Live preview of a press-and-hold range (#268 fix). When set, render a
   *  dashed rectangle from `start` to `end` so the participant sees the
   *  range growing while the Enter key is held. Cleared by Timeline on
   *  keyup or blur. */
  keyboardRangePreview?: { start: number; end: number; track?: number } | null;
  /** Pulse trigger for blocked range-create attempts. The overlay renders a
   *  brief outline glow on the ranges identified by `indices`, restarting
   *  whenever `token` changes (via React `key`). Owned by Timeline so both
   *  click-drag (via `onBlockedCreate`) and Enter trigger the same effect. */
  pulseTrigger?: { token: number; indices: number[] } | null;
  /** Called when the user attempted to create a range but it was blocked
   *  by single-select-with-existing-range. The parent is expected to
   *  trigger a `pulseTrigger` update so feedback shows up on the existing
   *  range(s). */
  onBlockedCreate?: (indices: number[]) => void;
}

const DRAG_DEAD_ZONE_PX = 4;

/**
 * Width of a range created by a click (no drag) in seconds. Long enough to
 * be visually distinct as a range rather than a line, short enough that
 * handles don't overlap for quick tuning. Matches ARROW_STEP in
 * keyboardActions so click-then-arrow feels consistent.
 */
const CLICK_CREATED_RANGE_SEC = 1;

/**
 * Minimum visual width (in pixels) for a click-created range. For long
 * videos at low zoom, 1 second can render at <1px, leaving the start and
 * end handles overlapping with no visible range between them. We expand
 * the range so the gap between the handles is at least this many pixels.
 *
 * Exported for reuse by Timeline.tsx's keyboard-tap range creation —
 * same purpose (avoid an invisible range from a near-instantaneous
 * input), same threshold.
 */
export const CLICK_CREATED_RANGE_MIN_PX = 6;

interface DragState {
  startX: number;
  startTime: number;
  /** Did the mouse move beyond the dead zone? */
  isDragging: boolean;
  /** What kind of drag is in progress. */
  mode: "create-range" | "adjust-handle" | "reposition-point" | "click";
  /** For adjust-handle: which selection and which handle. */
  index?: number;
  handle?: "start" | "end";
  /** For all drags in track mode: which track. */
  track?: number;
  /**
   * Has this drag already pushed its undo snapshot via onBeginDrag?
   * Used to ensure each drag collapses to a single undo step.
   */
  beganDrag?: boolean;
}

function isRangeArray(s: TimelineValue): s is RangeSelection[] {
  return s.length === 0 || "start" in (s[0] as object);
}

const HANDLE_HIT_WIDTH = 8;
const HANDLE_TIP_WIDTH = 2;

/**
 * Visual content of a range handle — three vertical sections stacked
 * top-to-middle-to-bottom. The thin top/bottom tips mark the actual range
 * boundary (same width as the playhead, so they read as precise endpoints);
 * the thick middle extends outward from the boundary as a wider grab
 * affordance, with two grip bars echoing OS resize-grip iconography. The
 * inner edge of the thick block aligns with the inner edge of the tips.
 *
 * The thick middle overflows the parent handle's CSS box outward — pointer
 * events still bubble up to the handle, so the visible grab area matches
 * what's clickable. The handle's own 8px-wide box stays centered on the
 * boundary so existing hit behavior (clicking near the edge to grab)
 * continues to work.
 */
function HandleVisual({
  handle,
  color,
}: {
  handle: "start" | "end";
  color: string;
}) {
  const isStart = handle === "start";
  // The parent handle's CSS box is 8px wide and centered on the boundary
  // (`left: -4 width: 8` for start, `right: -4 width: 8` for end). So the
  // boundary sits at the *center* of the parent box — half the box is
  // outside the range, half is inside. Anchoring a child with `right: 4`
  // (start) or `left: 4` (end) — i.e., `HANDLE_HIT_WIDTH / 2` from the
  // outer edge — places that child's inner edge exactly on the boundary.
  const innerOffset = HANDLE_HIT_WIDTH / 2;
  const innerEdge: React.CSSProperties = isStart
    ? { right: innerOffset }
    : { left: innerOffset };
  // Tips: 2px wide, sitting just outside the boundary so their inner edge
  // marks the actual endpoint of the range.
  const tipStyle: React.CSSProperties = {
    position: "absolute",
    width: HANDLE_TIP_WIDTH,
    background: color,
    pointerEvents: "none",
    ...innerEdge,
  };
  // Thick middle: 8px wide, inner edge at the boundary, extending outward.
  // The left half overflows the parent handle's box; pointer events still
  // bubble up to the handle, so clicks on the visible thick area are
  // captured as handle drags.
  const thickStyle: React.CSSProperties = {
    position: "absolute",
    top: "33%",
    bottom: "33%",
    width: HANDLE_HIT_WIDTH,
    background: color,
    ...innerEdge,
  };
  // Two faint grip bars centered inside the thick block (matches the prior
  // resize-grip iconography — the visual itself is what's changing, not
  // the affordance).
  const gripBar: React.CSSProperties = {
    position: "absolute",
    top: "25%",
    bottom: "25%",
    width: 1,
    background: "rgba(255, 255, 255, 0.75)",
    pointerEvents: "none",
  };
  return (
    <>
      <div style={{ ...tipStyle, top: 0, height: "33%" }} />
      <div style={thickStyle}>
        <div style={{ ...gripBar, left: 2 }} />
        <div style={{ ...gripBar, right: 2 }} />
      </div>
      <div style={{ ...tipStyle, bottom: 0, height: "33%" }} />
    </>
  );
}

/**
 * Renders all selections (ranges or points) and handles mouse/touch events
 * for creating, selecting, and editing them. Absolutely positioned over the
 * waveform area.
 */
export function SelectionOverlay({
  width,
  height,
  duration,
  zoomLevel,
  viewportStart,
  selectionType,
  selectionScope,
  channelCount,
  multiSelect,
  selections,
  activeIndex,
  activeHandle,
  onSeek,
  onCreateRange,
  onCreatePoint,
  onAdjustHandle,
  onRepositionPoint,
  onSelect,
  onDeselect,
  onSetActiveHandle,
  onBeginDrag,
  onEndDrag,
  onRequestFocus,
  keyboardRangePreview = null,
  pulseTrigger = null,
  onBlockedCreate,
}: SelectionOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  // Live drag preview for "create-range" before mouseup commits the range
  const [dragPreview, setDragPreview] = useState<{
    startTime: number;
    endTime: number;
    track: number | undefined;
  } | null>(null);
  // Track which handle is hovered for time tooltip display
  const [hoveredHandle, setHoveredHandle] = useState<{
    index: number;
    handle: "start" | "end";
  } | null>(null);

  const trackHeight = channelCount > 0 ? height / channelCount : height;

  const eventToTime = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      return pixelToTime(localX, duration, width, zoomLevel, viewportStart);
    },
    [duration, width, zoomLevel, viewportStart],
  );

  const eventToTrack = useCallback(
    (clientY: number): number | undefined => {
      if (selectionScope !== "track") return undefined;
      const el = containerRef.current;
      if (!el) return undefined;
      const rect = el.getBoundingClientRect();
      const localY = clientY - rect.top;
      const trackIdx = Math.floor(localY / trackHeight);
      return Math.max(0, Math.min(channelCount - 1, trackIdx));
    },
    [selectionScope, trackHeight, channelCount],
  );

  // ── Pointer handlers (mouse + touch unified) ──

  /** Capture the pointer so drag gestures continue even if the pointer
   *  leaves the overlay. Silently ignore failures in test environments
   *  where the pointerId may not be a real OS pointer. */
  const capturePointer = useCallback((e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const releasePointer = useCallback((e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      capturePointer(e);
      const time = eventToTime(e.clientX);
      const track = eventToTrack(e.clientY);
      dragRef.current = {
        startX: e.clientX,
        startTime: time,
        isDragging: false,
        mode: "click",
        track,
      };
    },
    [eventToTime, eventToTrack, capturePointer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = Math.abs(e.clientX - drag.startX);
      if (!drag.isDragging && dx < DRAG_DEAD_ZONE_PX) return;

      if (!drag.isDragging) {
        drag.isDragging = true;
        if (drag.mode === "click") {
          drag.mode =
            selectionType === "range" ? "create-range" : "reposition-point";
        }
      }

      const rawTime = eventToTime(e.clientX);
      const currentTime = Math.max(0, Math.min(duration, rawTime));

      if (drag.mode === "create-range") {
        setDragPreview({
          startTime: drag.startTime,
          endTime: currentTime,
          track: drag.track,
        });
      } else if (
        drag.mode === "adjust-handle" &&
        drag.index !== undefined &&
        drag.handle
      ) {
        // First move of an adjust-handle drag: snapshot once, then defer
        // saves until pointerup. Subsequent moves use noSnapshot=true so
        // the entire drag collapses to one undo step.
        if (!drag.beganDrag) {
          drag.beganDrag = true;
          onBeginDrag();
        }
        onAdjustHandle(drag.index, drag.handle, currentTime, true);
      } else if (drag.mode === "reposition-point" && drag.index !== undefined) {
        if (!drag.beganDrag) {
          drag.beganDrag = true;
          onBeginDrag();
        }
        onRepositionPoint(drag.index, currentTime, true);
      }
    },
    [
      eventToTime,
      duration,
      onAdjustHandle,
      onRepositionPoint,
      onBeginDrag,
      selectionType,
    ],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      releasePointer(e);
      const drag = dragRef.current;
      if (!drag) return;

      const rawTime = eventToTime(e.clientX);
      const time = Math.max(0, Math.min(duration, rawTime));
      const track = drag.track;

      if (!drag.isDragging) {
        if (drag.mode === "adjust-handle") {
          // Clicked a handle without dragging — keep it selected so
          // arrow keys adjust the handle rather than scrubbing the playhead.
          onRequestFocus();
        } else if (drag.mode === "reposition-point") {
          // Clicked an existing point without dragging — keep it
          // selected (handlePointPointerDown already called onSelect)
          // so the next keystroke (Delete, arrows) acts on the
          // selected point rather than creating a new one. Without
          // this branch a click on an existing point's hit area
          // would fall through to the `selectionType === "point"`
          // case below and silently stack a duplicate point at the
          // same time — making the existing point feel impossible
          // to delete via the click-then-Delete flow.
          onRequestFocus();
        } else if (selectionType === "point") {
          // Point mode: click anywhere creates a point. The reducer
          // enforces multiSelect (replacing an existing point in single
          // mode, appending otherwise), so this one path covers both.
          onCreatePoint(time, track);
          onSeek(time);
          onRequestFocus();
        } else {
          // Range mode: click creates a default-width range starting at
          // the click, EXCEPT in single-select mode when a range already
          // exists — there we preserve the existing work (adjustment
          // happens via handles). Seek is left to the media player's own
          // scrubber; click-to-add is the primary gesture on the timeline.
          const hasExistingRange =
            isRangeArray(selections) && selections.length > 0;
          if (!multiSelect && hasExistingRange) {
            // No range creation here, but still request focus so arrow /
            // Delete / Ctrl-Z keep working after the click (Timeline's
            // container is what owns the keyboard listeners). Pulse the
            // existing range so the user sees why the click did nothing.
            if (activeIndex !== null) onDeselect();
            onRequestFocus();
            onBlockedCreate?.(selections.map((_, i) => i));
          } else {
            // Pick a width that's at least CLICK_CREATED_RANGE_SEC AND at
            // least CLICK_CREATED_RANGE_MIN_PX wide on screen — for long
            // videos at low zoom 1 second can render sub-pixel, so the
            // pixel floor keeps the new range visible.
            const pxPerSec = duration > 0 ? (width * zoomLevel) / duration : 0;
            const widthSec =
              pxPerSec > 0
                ? Math.max(
                    CLICK_CREATED_RANGE_SEC,
                    CLICK_CREATED_RANGE_MIN_PX / pxPerSec,
                  )
                : CLICK_CREATED_RANGE_SEC;
            let start = time;
            let end = time + widthSec;
            if (end > duration) {
              end = duration;
              start = Math.max(0, duration - widthSec);
            }
            if (end - start > 0) {
              onCreateRange(start, end, track);
              onRequestFocus();
            }
          }
        }
      } else if (drag.mode === "create-range") {
        const start = Math.min(drag.startTime, time);
        const end = Math.max(drag.startTime, time);
        if (end - start > 0) {
          // Single-select with an existing range is blocked — the reducer
          // would no-op the dispatch anyway, but skip it explicitly so the
          // pulse callback fires and we don't push a phantom undo snapshot.
          const hasExistingRange =
            isRangeArray(selections) && selections.length > 0;
          if (!multiSelect && hasExistingRange) {
            onBlockedCreate?.(selections.map((_, i) => i));
            onRequestFocus();
          } else {
            onCreateRange(start, end, track);
            onRequestFocus();
          }
        }
        setDragPreview(null);
      }

      // Release the save defer for adjust-handle / reposition-point drags
      if (drag.beganDrag) {
        onEndDrag();
        onRequestFocus();
      }
      dragRef.current = null;
      setHoveredHandle(null);
    },
    [
      eventToTime,
      selectionType,
      activeIndex,
      duration,
      width,
      zoomLevel,
      selections,
      multiSelect,
      onCreatePoint,
      onSeek,
      onDeselect,
      onCreateRange,
      onEndDrag,
      onRequestFocus,
      onBlockedCreate,
      releasePointer,
    ],
  );

  const handleRangeBodyPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      e.stopPropagation();
      onSelect(index);
      onRequestFocus();
      dragRef.current = null;
    },
    [onSelect, onRequestFocus],
  );

  const handleHandlePointerDown = useCallback(
    (e: React.PointerEvent, index: number, handle: "start" | "end") => {
      e.stopPropagation();
      if (e.button !== 0) return;
      // Capture on the overlay container (parent), not the handle itself,
      // so pointermove/pointerup keep flowing to the overlay during drag.
      const overlay = containerRef.current;
      if (overlay) {
        try {
          overlay.setPointerCapture(e.pointerId);
        } catch {
          // ignore in test environments
        }
      }
      onSelect(index);
      onSetActiveHandle(handle);
      const time = eventToTime(e.clientX);
      dragRef.current = {
        startX: e.clientX,
        startTime: time,
        isDragging: false,
        mode: "adjust-handle",
        index,
        handle,
      };
    },
    [eventToTime, onSelect, onSetActiveHandle],
  );

  const handlePointPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const overlay = containerRef.current;
      if (overlay) {
        try {
          overlay.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      onSelect(index);
      const time = eventToTime(e.clientX);
      dragRef.current = {
        startX: e.clientX,
        startTime: time,
        isDragging: false,
        mode: "reposition-point",
        index,
      };
    },
    [eventToTime, onSelect],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      releasePointer(e);
      if (dragRef.current?.beganDrag) onEndDrag();
      dragRef.current = null;
      setDragPreview(null);
      setHoveredHandle(null);
    },
    [onEndDrag, releasePointer],
  );

  // ── Render ──

  const renderRanges = () => {
    if (!isRangeArray(selections)) return null;
    return selections.map((range, i) => {
      const isActive = i === activeIndex;
      const x1 = timeToPixel(
        range.start,
        duration,
        width,
        zoomLevel,
        viewportStart,
      );
      const x2 = timeToPixel(
        range.end,
        duration,
        width,
        zoomLevel,
        viewportStart,
      );
      const left = Math.min(x1, x2);
      const rangeWidth = Math.abs(x2 - x1);

      // When the end handle is near the right edge of the visible area,
      // put the start handle on top so the user can grab it to drag left.
      // At the left edge, the default (end handle on top via DOM order)
      // is correct since the end handle is the one that can move right.
      const startHandleOnTop = x2 > width - 10;

      // Hover-tooltip flip detection. Tooltip is ~50 px wide (varies with
      // timestamp text) and sits OUTSIDE the handle by default. If the
      // handle is too close to the SelectionOverlay's clipped edge, the
      // outside-default would be cut off — flip to the inside instead.
      const TOOLTIP_FLIP_PX = 50;
      const flipStartTooltip = x1 < TOOLTIP_FLIP_PX;
      const flipEndTooltip = x2 > width - TOOLTIP_FLIP_PX;

      // Per-track positioning in track scope
      const top =
        selectionScope === "track" && range.track !== undefined
          ? range.track * trackHeight
          : 0;
      const rangeHeight = selectionScope === "track" ? trackHeight : height;

      return (
        <div
          key={`range-${String(i)}`}
          data-testid={`range-${String(i)}`}
          data-active={isActive}
          onPointerDown={(e) => handleRangeBodyPointerDown(e, i)}
          style={{
            position: "absolute",
            left: `${String(left)}px`,
            top: `${String(top)}px`,
            width: `${String(rangeWidth)}px`,
            height: `${String(rangeHeight)}px`,
            background: isActive
              ? "var(--stagebook-timeline-range-active, rgba(59, 130, 246, 0.35))"
              : "var(--stagebook-timeline-range-inactive, rgba(59, 130, 246, 0.18))",
            border: isActive
              ? "1px solid var(--stagebook-timeline-range-active-border, rgba(37, 99, 235, 1))"
              : "1px solid var(--stagebook-timeline-range-inactive-border, rgba(59, 130, 246, 0.6))",
            boxSizing: "border-box",
            cursor: "pointer",
            pointerEvents: "auto",
            // Active range floats above siblings so its handles (which
            // overhang 4px outside the range body via `left: -4` /
            // `right: -4` with HANDLE_HIT_WIDTH=8) remain reachable
            // when another range abuts. Without this, clicking the
            // visible handle of an active range would hit the neighbor's
            // body — and the neighbor's `handleRangeBodyPointerDown`
            // would switch the active selection to the neighbor before
            // the handle drag could begin.
            zIndex: isActive ? 1 : 0,
          }}
        >
          {/* Start handle */}
          <div
            data-testid={`range-${String(i)}-handle-start`}
            data-active={isActive && activeHandle === "start"}
            draggable={false}
            onPointerDown={(e) => {
              e.preventDefault(); // suppress native drag-and-drop
              setHoveredHandle({ index: i, handle: "start" });
              handleHandlePointerDown(e, i, "start");
            }}
            onPointerEnter={() =>
              setHoveredHandle({ index: i, handle: "start" })
            }
            onPointerLeave={() => {
              if (!dragRef.current) setHoveredHandle(null);
            }}
            style={{
              position: "absolute",
              left: -(HANDLE_HIT_WIDTH / 2),
              top: 0,
              width: HANDLE_HIT_WIDTH,
              height: "100%",
              cursor: "ew-resize",
              zIndex: startHandleOnTop ? 2 : 1,
            }}
          >
            <HandleVisual
              handle="start"
              color={
                isActive && activeHandle === "start"
                  ? "var(--stagebook-timeline-handle-active, rgba(37, 99, 235, 1))"
                  : "var(--stagebook-timeline-handle-inactive, rgba(59, 130, 246, 0.7))"
              }
            />
            {hoveredHandle?.index === i &&
              hoveredHandle?.handle === "start" && (
                <div
                  data-testid="handle-tooltip"
                  style={handleTooltipStyle("start", flipStartTooltip)}
                >
                  {formatTime(range.start, zoomDecimals(zoomLevel))}
                </div>
              )}
          </div>
          {/* End handle */}
          <div
            data-testid={`range-${String(i)}-handle-end`}
            data-active={isActive && activeHandle === "end"}
            draggable={false}
            onPointerDown={(e) => {
              e.preventDefault(); // suppress native drag-and-drop
              setHoveredHandle({ index: i, handle: "end" });
              handleHandlePointerDown(e, i, "end");
            }}
            onPointerEnter={() => setHoveredHandle({ index: i, handle: "end" })}
            onPointerLeave={() => {
              if (!dragRef.current) setHoveredHandle(null);
            }}
            style={{
              position: "absolute",
              right: -(HANDLE_HIT_WIDTH / 2),
              top: 0,
              width: HANDLE_HIT_WIDTH,
              height: "100%",
              cursor: "ew-resize",
              zIndex: startHandleOnTop ? 1 : 2,
            }}
          >
            <HandleVisual
              handle="end"
              color={
                isActive && activeHandle === "end"
                  ? "var(--stagebook-timeline-handle-active, rgba(37, 99, 235, 1))"
                  : "var(--stagebook-timeline-handle-inactive, rgba(59, 130, 246, 0.7))"
              }
            />
            {hoveredHandle?.index === i && hoveredHandle?.handle === "end" && (
              <div
                data-testid="handle-tooltip"
                style={handleTooltipStyle("end", flipEndTooltip)}
              >
                {formatTime(range.end, zoomDecimals(zoomLevel))}
              </div>
            )}
          </div>
        </div>
      );
    });
  };

  const renderPoints = () => {
    if (isRangeArray(selections)) return null;
    return selections.map((point, i) => {
      const isActive = i === activeIndex;
      const x = timeToPixel(
        point.time,
        duration,
        width,
        zoomLevel,
        viewportStart,
      );
      const top =
        selectionScope === "track" && point.track !== undefined
          ? point.track * trackHeight
          : 0;
      const pointHeight = selectionScope === "track" ? trackHeight : height;
      return (
        <div
          key={`point-${String(i)}`}
          data-testid={`point-${String(i)}`}
          data-active={isActive}
          onPointerDown={(e) => handlePointPointerDown(e, i)}
          style={{
            position: "absolute",
            left: `${String(x - 5)}px`,
            top: `${String(top)}px`,
            width: 10,
            height: `${String(pointHeight)}px`,
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 4,
              top: 0,
              width: 2,
              height: "100%",
              background: isActive
                ? "var(--stagebook-timeline-handle-active, rgba(37, 99, 235, 1))"
                : "var(--stagebook-timeline-handle-inactive, rgba(59, 130, 246, 0.7))",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: -2,
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: isActive
                ? "var(--stagebook-timeline-handle-active, rgba(37, 99, 235, 1))"
                : "var(--stagebook-timeline-handle-inactive, rgba(59, 130, 246, 0.7))",
            }}
          />
        </div>
      );
    });
  };

  const renderDragPreview = () => {
    if (!dragPreview) return null;

    // Clamp the preview to free space so it doesn't visually overlap existing
    // ranges — matching the clamping that will happen on commit (pointerup).
    // When multiSelect is false the new range replaces all existing ones, so
    // there's nothing to clamp against.
    const existing = multiSelect && isRangeArray(selections) ? selections : [];
    const clamped = clampToFreeGap(
      dragPreview.startTime,
      dragPreview.endTime,
      dragPreview.track,
      existing,
    );
    if (!clamped) return null; // no free space

    const x1 = timeToPixel(
      clamped.start,
      duration,
      width,
      zoomLevel,
      viewportStart,
    );
    const x2 = timeToPixel(
      clamped.end,
      duration,
      width,
      zoomLevel,
      viewportStart,
    );
    const left = Math.min(x1, x2);
    const previewWidth = Math.abs(x2 - x1);
    const top =
      selectionScope === "track" && dragPreview.track !== undefined
        ? dragPreview.track * trackHeight
        : 0;
    const previewHeight = selectionScope === "track" ? trackHeight : height;
    return (
      <div
        data-testid="range-drag-preview"
        style={{
          position: "absolute",
          left: `${String(left)}px`,
          top: `${String(top)}px`,
          width: `${String(previewWidth)}px`,
          height: `${String(previewHeight)}px`,
          background:
            "var(--stagebook-timeline-preview-bg, rgba(59, 130, 246, 0.25))",
          border:
            "1px dashed var(--stagebook-timeline-preview-border, rgba(59, 130, 246, 0.6))",
          boxSizing: "border-box",
          pointerEvents: "none",
        }}
      />
    );
  };

  // Pulse overlays for blocked range-create attempts. Renders a brief
  // outline glow on each existing range identified by `pulseTrigger.indices`.
  // The `key` includes `pulseTrigger.token` so each blocked attempt
  // remounts the element and restarts the animation.
  const renderBlockedPulses = () => {
    if (!pulseTrigger || pulseTrigger.indices.length === 0) return null;
    if (!isRangeArray(selections)) return null;
    return pulseTrigger.indices.map((idx) => {
      const r = selections[idx];
      if (!r) return null;
      const x1 = timeToPixel(
        r.start,
        duration,
        width,
        zoomLevel,
        viewportStart,
      );
      const x2 = timeToPixel(r.end, duration, width, zoomLevel, viewportStart);
      const left = Math.min(x1, x2);
      const pulseWidth = Math.abs(x2 - x1);
      const top =
        selectionScope === "track" && r.track !== undefined
          ? r.track * trackHeight
          : 0;
      const pulseHeight = selectionScope === "track" ? trackHeight : height;
      return (
        <div
          key={`pulse-${String(pulseTrigger.token)}-${String(idx)}`}
          data-testid="range-blocked-pulse"
          className="stagebook-range-blocked-pulse"
          style={{
            position: "absolute",
            left: `${String(left)}px`,
            top: `${String(top)}px`,
            width: `${String(pulseWidth)}px`,
            height: `${String(pulseHeight)}px`,
            pointerEvents: "none",
            borderRadius: 2,
            // `animation` lives in the scoped <style> block (not
            // inline) so the `@media (prefers-reduced-motion: reduce)`
            // rule below can set it to `none`. Inline-style specificity
            // would block the media-query override — same trap as
            // Slider / TextArea / Button. The pre-#382 implementation
            // redefined the keyframes inside the media query, which
            // does work for swapping animation content but doesn't
            // honor a true "no animation" preference (a background
            // fade is still motion).
          }}
        />
      );
    });
  };

  // Live preview while Enter is held for press-and-hold range creation
  // (#268 fix). Mirrors the click-drag preview style. Unlike the click
  // path, we don't clamp against existing ranges here — the keyup commit
  // path clamps if needed, and showing a clipped preview during the hold
  // would feel jumpy as the playhead moves.
  const renderKeyboardRangePreview = () => {
    if (!keyboardRangePreview) return null;
    const x1 = timeToPixel(
      keyboardRangePreview.start,
      duration,
      width,
      zoomLevel,
      viewportStart,
    );
    const x2 = timeToPixel(
      keyboardRangePreview.end,
      duration,
      width,
      zoomLevel,
      viewportStart,
    );
    const left = Math.min(x1, x2);
    const previewWidth = Math.abs(x2 - x1);
    const top =
      selectionScope === "track" && keyboardRangePreview.track !== undefined
        ? keyboardRangePreview.track * trackHeight
        : 0;
    const previewHeight = selectionScope === "track" ? trackHeight : height;
    return (
      <div
        data-testid="range-keyboard-preview"
        style={{
          position: "absolute",
          left: `${String(left)}px`,
          top: `${String(top)}px`,
          width: `${String(previewWidth)}px`,
          height: `${String(previewHeight)}px`,
          background:
            "var(--stagebook-timeline-preview-bg, rgba(59, 130, 246, 0.25))",
          border:
            "1px dashed var(--stagebook-timeline-preview-border, rgba(59, 130, 246, 0.6))",
          boxSizing: "border-box",
          pointerEvents: "none",
        }}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      data-testid="selection-overlay"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={() => {
        // With pointer capture active, this only fires for uncaptured
        // interactions (e.g., hover without mousedown). For captured drags,
        // pointerup/pointercancel handle cleanup instead.
        if (dragRef.current) {
          if (dragRef.current.beganDrag) onEndDrag();
          dragRef.current = null;
          setDragPreview(null);
        }
      }}
      style={{
        position: "absolute",
        inset: 0,
        // Clip ranges/points/drag preview at the waveform bounds so they
        // don't bleed into the gutter (left) when scrolled into a range
        // whose start is off-screen. The right side is already clipped by
        // the outer timeline's overflow:hidden.
        overflow: "hidden",
        // Crosshair signals "click adds a selection here." In single-select
        // range mode once a range exists, clicking empty space is a no-op
        // (we preserve the existing range) — switch to the default cursor
        // so the affordance doesn't lie about what a click will do.
        cursor:
          selectionType === "range" &&
          !multiSelect &&
          isRangeArray(selections) &&
          selections.length > 0
            ? "default"
            : "crosshair",
        pointerEvents: "auto",
      }}
    >
      <style>{`
        @keyframes stagebookRangeBlockedPulse {
          0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
          30% { box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.55); }
          100% { box-shadow: 0 0 0 8px rgba(220, 38, 38, 0); }
        }
        .stagebook-range-blocked-pulse {
          animation: stagebookRangeBlockedPulse 600ms ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .stagebook-range-blocked-pulse {
            /* True reduced-motion: drop the animation. The pre-#382
               implementation redefined the keyframes to a background
               fade — still animation, just less. Users who opted
               into reduced motion get a static (no-op) pulse div
               for the 600ms its lifecycle covers. The
               range-blocked-pulse is a redundant signal (the
               attempted range visibly fails to commit), so dropping
               the animation isn't a hard accessibility regression. */
            animation: none;
          }
        }
      `}</style>
      {selectionType === "range" ? renderRanges() : renderPoints()}
      {renderDragPreview()}
      {renderKeyboardRangePreview()}
      {renderBlockedPulses()}
    </div>
  );
}
