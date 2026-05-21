import React, {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { usePlayback } from "../playback/PlaybackProvider.js";
import { TimeRuler, RULER_HEIGHT } from "./timeline/TimeRuler.js";
import { TimelineTrack, GUTTER_WIDTH } from "./timeline/TimelineTrack.js";
import { Playhead } from "./timeline/Playhead.js";
import {
  SelectionOverlay,
  CLICK_CREATED_RANGE_MIN_PX,
} from "./timeline/SelectionOverlay.js";
import { TimelineFooter } from "./timeline/TimelineFooter.js";
import { TimelineHeader } from "./timeline/TimelineHeader.js";
import { Minimap } from "./timeline/Minimap.js";
import { HelpPopover } from "./timeline/HelpPopover.js";
import { computeBucketCount } from "./mediaPlayer/waveformCapture.js";
import {
  initialSelectionState,
  selectionsReducer,
} from "./timeline/selectionsReducer.js";
import {
  keyToAction,
  keyUpToAction,
  type KeyContext,
  type KeyEventLike,
} from "./timeline/keyboardActions.js";
import type { PointSelection, RangeSelection } from "./timeline/selections.js";
import {
  AUTO_SCROLL_THRESHOLD,
  SEEK_JUMP_THRESHOLD,
  clampViewportStart,
  computeViewportAfterFocalZoom,
  computeViewportAfterPan,
  computeViewportAfterScroll,
  computeViewportAfterSeek,
  computeViewportAfterZoom,
  isPlayheadPastThreshold,
  normalizeWheelDelta,
  pinchZoom,
  zoomIn as nextZoomIn,
  zoomOut as nextZoomOut,
} from "./timeline/viewport.js";

export interface TimelineProps {
  source: string;
  name: string;
  selectionType: "range" | "point";
  selectionScope?: "track" | "all";
  multiSelect?: boolean;
  showWaveform?: boolean;
  trackLabels?: string[];
  /**
   * Previously saved selections to restore on mount. Element.tsx resolves
   * this from `timeline.<name>` so participants who reload the stage see
   * their existing marks. Untrusted shape — validated before use.
   */
  initialSelections?: unknown;
  save: (key: string, value: unknown) => void;
}

const TRACK_HEIGHT = 48;
const BUCKETS_PER_SECOND = 10;

/**
 * Validate restored selections from saved state. Returns an empty array if
 * the input is malformed — better to start fresh than to crash on a bad save.
 */
function validateSavedSelections(
  raw: unknown,
  selectionType: "range" | "point",
): RangeSelection[] | PointSelection[] {
  if (!Array.isArray(raw)) return [];
  if (selectionType === "range") {
    const valid: RangeSelection[] = [];
    for (const item of raw) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { start?: unknown }).start === "number" &&
        typeof (item as { end?: unknown }).end === "number" &&
        Number.isFinite((item as { start: number }).start) &&
        Number.isFinite((item as { end: number }).end)
      ) {
        const r: RangeSelection = {
          start: (item as { start: number }).start,
          end: (item as { end: number }).end,
        };
        const t = (item as { track?: unknown }).track;
        if (typeof t === "number" && Number.isFinite(t)) r.track = t;
        valid.push(r);
      }
    }
    return valid;
  }
  const valid: PointSelection[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { time?: unknown }).time === "number" &&
      Number.isFinite((item as { time: number }).time)
    ) {
      const p: PointSelection = { time: (item as { time: number }).time };
      const t = (item as { track?: unknown }).track;
      if (typeof t === "number" && Number.isFinite(t)) p.track = t;
      valid.push(p);
    }
  }
  return valid;
}

export function Timeline({
  source,
  name,
  selectionType,
  selectionScope = "all",
  multiSelect = false,
  showWaveform = true,
  trackLabels,
  initialSelections,
  save,
}: TimelineProps) {
  const handle = usePlayback(source);
  const tracksAreaRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Ref `save` so the save-on-change effect below doesn't re-run (and
  // potentially double-save) whenever the parent passes a fresh callback
  // identity (#105).
  const saveRef = useRef(save);
  saveRef.current = save;

  // Callback ref: measures the container immediately on attach. Works
  // regardless of mount order — unlike useEffect, a callback ref fires when
  // React attaches the DOM element, even if the component re-renders later
  // (e.g. when the playback handle becomes available).
  // Also stores the element in containerElRef so we can call .focus() later.
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerElRef = useRef<HTMLDivElement | null>(null);
  // Per-instance class for the container's `:focus-visible` ring (#382
  // polish). Same useId pattern as Button / Slider / ListSorter /
  // TextArea. Sanitized for use as a CSS class.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const containerClass = `stagebook-timeline-container-${safeId}`;
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    containerElRef.current = el;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  // Zoom & pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewportStart, setViewportStart] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  // Per-track mute state. Ephemeral (not persisted, not saved) — a
  // listening aid only. Default: all tracks unmuted. Starts empty and
  // grows lazily as tracks are toggled. Kept as local state solely to
  // trigger re-renders; the source of truth for `muted` is the handle.
  const [, setMuteTick] = useState(0);

  // Track whether the playhead changes are "natural playback" (RAF tick)
  // versus "external seek" (someone called handle.seekTo() out of band).
  // Auto-scroll uses the former; snap-on-seek uses the latter.
  const lastPlayheadRef = useRef(0);
  const lastTickWasPlayingRef = useRef(false);

  // Set true while the user is actively dragging the red playhead time
  // box. Auto-scroll skips while this is true — otherwise the scroll
  // chases the cursor (cursor at >90% scrolls right; new viewport puts
  // cursor at >90% again; runaway) and the user can't stop near the edge.
  const playheadDraggingRef = useRef(false);

  // Range mode press-and-hold annotation (#263). When the user presses
  // Enter in range mode we stash the playhead time here; the matching
  // keyup commits a range from this start to wherever the playhead is
  // at release. Cleared on commit, on Escape mid-hold, and on blur so a
  // dropped focus during the hold doesn't leave a stale start.
  const pendingRangeStartRef = useRef<number | null>(null);
  // State mirror of pendingRangeStartRef for re-rendering the live
  // preview rectangle while Enter is held (#268 fix). Kept in lockstep
  // with the ref so the keyup handler can read synchronously while the
  // overlay still re-renders on each playhead tick.
  const [pendingRangeStartTime, setPendingRangeStartTime] = useState<
    number | null
  >(null);
  // Pulse trigger for blocked range-create attempts. Token increments each
  // time the user attempts a creation that's blocked (single-select with
  // an existing range, or multi-select with the playhead inside an existing
  // range); SelectionOverlay restarts its pulse animation via React `key`.
  const [pulseTrigger, setPulseTrigger] = useState<{
    token: number;
    indices: number[];
  } | null>(null);
  const triggerBlockedPulse = useCallback((indices: number[]) => {
    setPulseTrigger((prev) => ({
      token: (prev?.token ?? 0) + 1,
      indices,
    }));
  }, []);

  // Selection state via reducer. Lazy initializer hydrates from saved state
  // when present so participants who reload mid-stage see their existing
  // selections (validated to drop malformed items).
  const [state, dispatch] = useReducer(selectionsReducer, undefined, () => {
    const base = initialSelectionState();
    if (initialSelections === undefined) return base;
    return {
      ...base,
      selections: validateSavedSelections(initialSelections, selectionType),
    };
  });

  // Drag transaction state — set true between BEGIN_DRAG (first pointermove
  // past the dead zone) and pointerup/leave. While true, the save effect
  // skips so we don't spam the server with one save per pixel of motion.
  const [isDragging, setIsDragging] = useState(false);

  // Save selections whenever they change (after the initial mount). Mouse-
  // driven changes save immediately on commit (drag end / click); keyboard
  // adjustments are debounced ~500ms so holding an arrow key collapses to
  // one save; mid-drag pointermove dispatches are deferred until the drag
  // ends to avoid server spam.
  const lastSavedRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set to true by the keyboard handler before dispatching, so the save
  // effect can debounce this particular state change. Reset after the save.
  const debounceNextSaveRef = useRef(false);
  useEffect(() => {
    const serialized = JSON.stringify(state.selections);
    if (lastSavedRef.current === null) {
      lastSavedRef.current = serialized;
      return;
    }
    if (serialized === lastSavedRef.current) return;
    // While a pointer drag is in progress, defer — the save will fire when
    // isDragging transitions back to false (this same effect re-runs).
    if (isDragging) return;

    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);

    if (debounceNextSaveRef.current) {
      debounceNextSaveRef.current = false;
      saveTimerRef.current = setTimeout(() => {
        lastSavedRef.current = serialized;
        saveRef.current(`timeline_${name}`, state.selections);
        saveTimerRef.current = null;
      }, 500);
    } else {
      lastSavedRef.current = serialized;
      saveRef.current(`timeline_${name}`, state.selections);
    }

    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [state.selections, isDragging, name]);

  // Measure container width. Read from getBoundingClientRect on every render
  // via a callback ref, and observe with ResizeObserver for ongoing updates.
  // The callback ref fires synchronously when the element is attached, which
  // gives a usable width on first paint even in test environments where the
  // ResizeObserver callback is delayed.

  // Keep a ref to the handle so other effects can read the current handle
  // without re-running when its identity changes.
  const handleRef = useRef(handle);
  handleRef.current = handle;

  // Request waveform capture once the handle becomes available. We depend
  // on `handle` (not just on `showWaveform`) so the effect re-runs when the
  // handle transitions from undefined to defined — important when MediaPlayer
  // and Timeline mount in the same render but the handle is registered in a
  // post-render effect from MockPlayer / MediaPlayer.
  useEffect(() => {
    if (!handle) return;
    if (showWaveform) {
      handle.requestWaveformCapture();
    }
    setCurrentTime(handle.getCurrentTime());
  }, [handle, showWaveform]);

  // Poll currentTime + peaksVersion + isPaused via RAF. peaksVersion is the
  // render token for the waveform — peaks are mutated in place by the
  // capture loop, so React never sees the array reference change. Polling
  // the version and storing it in state lets the WaveformRenderer effect
  // re-run when new data arrives.
  const [isPaused, setIsPaused] = useState(true);
  const [peaksVersion, setPeaksVersion] = useState(0);
  const [, setDurationVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let lastValue = -1;
    let lastPaused: boolean | null = null;
    let lastPeaksVersion = -1;
    let lastDurationVersion = -1;
    let rafId = 0;

    function tick() {
      if (cancelled) return;
      const h = handleRef.current;
      if (h) {
        const t = h.getCurrentTime();
        if (t !== lastValue) {
          lastValue = t;
          setCurrentTime(t);
        }
        const paused = h.isPaused();
        if (paused !== lastPaused) {
          lastPaused = paused;
          setIsPaused(paused);
        }
        const v = h.peaksVersion;
        if (v !== lastPeaksVersion) {
          lastPeaksVersion = v;
          setPeaksVersion(v);
        }
        const dv = h.durationVersion ?? 0;
        if (dv !== lastDurationVersion) {
          lastDurationVersion = dv;
          setDurationVersion(dv);
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  // Viewport scrolling effect: keeps the playhead within view as it moves.
  // - During playback: when playhead crosses 90%, scroll smoothly
  // - On seek/scrub (large playhead delta): snap so playhead is at ~25%
  //
  // Only triggered by playhead motion, not by viewport changes — otherwise
  // a manual pan via the minimap would immediately get undone (the playhead
  // would suddenly look "off-screen" relative to the new viewport).
  useEffect(() => {
    if (zoomLevel <= 1) return;
    const duration = handleRef.current?.getDuration() ?? 0;
    if (duration <= 0) return;

    const visibleDuration = duration / zoomLevel;
    const lastT = lastPlayheadRef.current;
    lastPlayheadRef.current = currentTime;
    lastTickWasPlayingRef.current = !isPaused;

    // While the user is manually dragging the playhead, they're the
    // source of motion — auto-scroll/snap would fight the cursor and
    // either run away to the edge or yank the viewport mid-drag.
    if (playheadDraggingRef.current) return;

    // No motion → nothing to do
    if (currentTime === lastT) return;

    // Detect "jump" — large delta or transition to/from playing means
    // the user seeked rather than naturally played through
    const delta = currentTime - lastT;
    const isJump = Math.abs(delta) > SEEK_JUMP_THRESHOLD;

    if (isJump) {
      // Snap viewport so the playhead is ~25% from the left
      const newStart = computeViewportAfterSeek(
        currentTime,
        visibleDuration,
        duration,
      );
      setViewportStart(newStart);
      return;
    }

    // Continuous playback: auto-scroll when playhead crosses 90%
    if (
      isPlayheadPastThreshold(
        currentTime,
        viewportStart,
        visibleDuration,
        AUTO_SCROLL_THRESHOLD,
      )
    ) {
      const newStart = computeViewportAfterScroll(
        currentTime,
        visibleDuration,
        duration,
      );
      if (newStart !== viewportStart) setViewportStart(newStart);
    }
  }, [currentTime, isPaused, zoomLevel, viewportStart]);

  // Zoom handlers
  const onZoomIn = useCallback(() => {
    const duration = handleRef.current?.getDuration() ?? 0;
    if (duration <= 0) return;
    const newZoom = nextZoomIn(zoomLevel);
    if (newZoom === zoomLevel) return;
    setZoomLevel(newZoom);
    setViewportStart(
      computeViewportAfterZoom({
        currentZoom: zoomLevel,
        newZoom,
        duration,
        currentViewportStart: viewportStart,
        playheadTime: currentTime,
      }),
    );
  }, [zoomLevel, viewportStart, currentTime]);

  const onZoomOut = useCallback(() => {
    const duration = handleRef.current?.getDuration() ?? 0;
    if (duration <= 0) return;
    const newZoom = nextZoomOut(zoomLevel);
    if (newZoom === zoomLevel) return;
    setZoomLevel(newZoom);
    setViewportStart(
      computeViewportAfterZoom({
        currentZoom: zoomLevel,
        newZoom,
        duration,
        currentViewportStart: viewportStart,
        playheadTime: currentTime,
      }),
    );
  }, [zoomLevel, viewportStart, currentTime]);

  const onMinimapPan = useCallback(
    (newStart: number) => {
      const duration = handleRef.current?.getDuration() ?? 0;
      setViewportStart(clampViewportStart(newStart, duration, zoomLevel));
    },
    [zoomLevel],
  );

  // Trackpad gestures: ctrl+wheel = pinch-to-zoom centered on the cursor;
  // horizontal-dominant wheel (two-finger swipe left/right) = pan when
  // zoomed in. Vertical-dominant wheel passes through to scroll the page.
  //
  // Bound natively (not via React's onWheel) with passive: false so we can
  // call preventDefault on gestures we handle. Refs feed the latest zoom
  // and viewport into the handler so we don't re-attach on every change.
  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;
  const viewportStartRef = useRef(viewportStart);
  viewportStartRef.current = viewportStart;
  useEffect(() => {
    const el = containerElRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const dur = handleRef.current?.getDuration() ?? 0;
      if (dur <= 0) return;
      const rect = el.getBoundingClientRect();
      const waveformWidth = Math.max(rect.width - GUTTER_WIDTH, 0);
      if (waveformWidth <= 0) return;

      // Normalize deltas to pixels. Trackpads always report PIXEL mode
      // (0); some mouse wheels and rare browsers report LINE (1) or
      // PAGE (2). Without this our pan/pinch sensitivity would silently
      // become wildly off on those input devices.
      const dx = normalizeWheelDelta(e.deltaX, e.deltaMode);
      const dy = normalizeWheelDelta(e.deltaY, e.deltaMode);

      // Chromium/Safari report trackpad pinch as wheel + ctrlKey, even
      // without the Control key being physically pressed.
      if (e.ctrlKey) {
        e.preventDefault();
        const currentZoom = zoomLevelRef.current;
        const newZoom = pinchZoom(currentZoom, dy);
        if (newZoom === currentZoom) return;
        // Anchor the zoom on the time under the cursor so it stays put.
        const cursorX = e.clientX - rect.left - GUTTER_WIDTH;
        const focalRatio = Math.max(0, Math.min(1, cursorX / waveformWidth));
        const visible = dur / currentZoom;
        const focalTime = viewportStartRef.current + visible * focalRatio;
        setZoomLevel(newZoom);
        setViewportStart(
          computeViewportAfterFocalZoom({
            newZoom,
            duration: dur,
            focalTime,
            focalRatio,
          }),
        );
        return;
      }

      // Horizontal pan only when zoomed in (otherwise there's nothing to
      // pan to) and only when the gesture is unambiguously horizontal —
      // pure vertical scroll passes through to the page.
      if (zoomLevelRef.current <= 1) return;
      if (Math.abs(dx) <= Math.abs(dy)) return;
      e.preventDefault();
      setViewportStart(
        computeViewportAfterPan({
          currentViewportStart: viewportStartRef.current,
          deltaPx: dx,
          waveformWidthPx: waveformWidth,
          duration: dur,
          zoomLevel: zoomLevelRef.current,
        }),
      );
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
    // Re-run when the playback handle materializes — until then the
    // timeline div isn't rendered (we show an error fallback) and
    // containerElRef.current is null, so an initial-mount-only effect
    // would never bind the listener.
  }, [handle]);

  // Keyboard handler — delegates to keyboardActions.ts for the key-to-action
  // mapping. Returns null when the key should fall through to MediaPlayer.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const currentRange =
      selectionType === "range" && state.activeIndex !== null
        ? ((state.selections as RangeSelection[])[state.activeIndex] ?? null)
        : null;
    const currentPoint =
      selectionType === "point" && state.activeIndex !== null
        ? ((state.selections as PointSelection[])[state.activeIndex] ?? null)
        : null;

    const eventLike: KeyEventLike = {
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      repeat: e.repeat,
    };
    const ctx: KeyContext = {
      selectionType,
      activeIndex: state.activeIndex,
      activeHandle: state.activeHandle,
      currentRange,
      currentPoint,
    };
    const action = keyToAction(eventLike, ctx);
    if (!action) return; // Fall through to MediaPlayer

    e.preventDefault();
    e.stopPropagation();

    // Clamp time to [0, duration] before dispatch + seek so a keyboard
    // adjustment can never push a selection past the media bounds.
    const dur = handleRef.current?.getDuration() ?? 0;
    const clampToMedia = (t: number): number => {
      if (Number.isFinite(dur) && dur > 0) {
        return Math.max(0, Math.min(t, dur));
      }
      return Math.max(0, t);
    };

    switch (action.type) {
      case "adjustHandle": {
        const t = clampToMedia(action.time);
        debounceNextSaveRef.current = true;
        dispatch({
          type: "ADJUST_HANDLE",
          index: action.index,
          handle: action.handle,
          time: t,
        });
        // Sync video to the new handle position so the user sees the frame
        handleRef.current?.seekTo(t);
        break;
      }
      case "repositionPoint": {
        const t = clampToMedia(action.time);
        debounceNextSaveRef.current = true;
        dispatch({
          type: "REPOSITION_POINT",
          index: action.index,
          time: t,
        });
        handleRef.current?.seekTo(t);
        break;
      }
      case "switchHandle":
        dispatch({ type: "SET_ACTIVE_HANDLE", handle: action.handle });
        break;
      case "delete":
        dispatch({ type: "DELETE" });
        break;
      case "deselect":
        dispatch({ type: "DESELECT" });
        break;
      case "undo":
        dispatch({ type: "UNDO" });
        break;
      case "togglePlayPause":
        if (handleRef.current?.isPaused()) {
          handleRef.current.play();
        } else {
          handleRef.current?.pause();
        }
        break;
      case "seekPlayhead": {
        const current = handleRef.current?.getCurrentTime() ?? 0;
        const t = clampToMedia(current + action.delta);
        handleRef.current?.seekTo(t);
        break;
      }
      case "createPointAtPlayhead": {
        // Real-time point annotation (#263). One Enter press = one point
        // at the current playhead. The reducer's CREATE_POINT honors
        // multiSelect (appends if true, replaces if false), so this
        // single dispatch covers both modes.
        const t = clampToMedia(handleRef.current?.getCurrentTime() ?? 0);
        dispatch({
          type: "CREATE_POINT",
          time: t,
          track: undefined,
          multiSelect,
        });
        break;
      }
      case "beginRangeAtPlayhead": {
        // Press-and-hold range, keydown half (#263). Stash the current
        // playhead time; the matching keyup will commit the range.
        // Auto-repeat keydowns are filtered upstream by keyToAction.
        const t = clampToMedia(handleRef.current?.getCurrentTime() ?? 0);

        // Blocked-attempt detection. Match what click/drag would do at
        // commit time so the user sees consistent behavior across input
        // modalities. Pulse the obstructing range(s) instead of starting
        // a hold that would be silently rejected on keyup.
        const existingRanges =
          selectionType === "range"
            ? (state.selections as RangeSelection[])
            : [];
        if (!multiSelect && existingRanges.length > 0) {
          // Single-select: any existing range blocks creation.
          triggerBlockedPulse(existingRanges.map((_, i) => i));
          break;
        }
        if (multiSelect) {
          // Multi-select: only ranges containing the press time block.
          // (clampToFreeGap returns null on commit if fully enclosed.)
          const blockingIndices: number[] = [];
          existingRanges.forEach((r, i) => {
            if (t >= r.start && t < r.end) blockingIndices.push(i);
          });
          if (blockingIndices.length > 0) {
            triggerBlockedPulse(blockingIndices);
            break;
          }
        }

        pendingRangeStartRef.current = t;
        setPendingRangeStartTime(t);
        break;
      }
    }
  };

  // Press-and-hold range, keyup half (#263). The user pressed Enter at
  // some point time A and released it at the current playhead — which
  // may differ from A if the video kept playing or they scrubbed during
  // the hold. Commit a range from min(A, current) to max(A, current),
  // with the same min-pixel-width clamp the click-create path uses so a
  // near-instantaneous tap still produces a visible range.
  const onKeyUp = (e: React.KeyboardEvent) => {
    const eventLike: KeyEventLike = {
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    };
    const ctx: KeyContext = {
      selectionType,
      activeIndex: state.activeIndex,
      activeHandle: state.activeHandle,
      currentRange: null,
      currentPoint: null,
    };
    const action = keyUpToAction(eventLike, ctx);
    if (!action) return;

    e.preventDefault();
    e.stopPropagation();

    if (action.type === "endRangeAtPlayhead") {
      const startTime = pendingRangeStartRef.current;
      pendingRangeStartRef.current = null;
      setPendingRangeStartTime(null);
      // Keyup without a prior keydown (e.g., focus changed mid-press) —
      // ignore.
      if (startTime === null) return;

      const dur = handleRef.current?.getDuration() ?? 0;
      const clampToMediaLocal = (t: number): number => {
        if (Number.isFinite(dur) && dur > 0) {
          return Math.max(0, Math.min(t, dur));
        }
        return Math.max(0, t);
      };
      const endTime = clampToMediaLocal(
        handleRef.current?.getCurrentTime() ?? 0,
      );

      let lo = Math.min(startTime, endTime);
      let hi = Math.max(startTime, endTime);

      // Min-visible-width clamp: a brief tap shouldn't produce an
      // invisible range. Mirrors the click-create path's behavior.
      // (Compute waveform width inline; the top-level `waveformWidth`
      // const is declared further down in the function body.)
      const waveformWidthLocal = Math.max(containerWidth - GUTTER_WIDTH, 0);
      if (waveformWidthLocal > 0 && dur > 0) {
        const pxPerSec = (waveformWidthLocal * zoomLevel) / dur;
        if (pxPerSec > 0) {
          const minSec = CLICK_CREATED_RANGE_MIN_PX / pxPerSec;
          if (hi - lo < minSec) {
            hi = lo + minSec;
            if (hi > dur) {
              hi = dur;
              lo = Math.max(0, dur - minSec);
            }
          }
        }
      }

      if (hi - lo > 0) {
        dispatch({
          type: "CREATE_RANGE",
          start: lo,
          end: hi,
          track: undefined,
          multiSelect,
        });
      }
    }
  };

  // Toggle mute for a single channel. Updates local UI state and calls
  // through to the shared PlaybackHandle so the underlying GainNode is
  // silenced in the audio output. Not saved. Declared before any early
  // return so hook order stays stable across renders; reads the handle
  // from a ref to avoid re-creating when the handle identity changes.
  const onToggleMute = useCallback((trackIndex: number, nextMuted: boolean) => {
    handleRef.current?.setChannelMuted(trackIndex, nextMuted);
    // Bump a tick so this Timeline re-reads handle.isChannelMuted().
    setMuteTick((t) => t + 1);
  }, []);

  if (!handle) {
    return (
      <p
        data-testid="timeline-error"
        style={{
          color: "var(--stagebook-danger, #dc2626)",
          fontSize: "0.875rem",
        }}
      >
        Timeline: no media player found with name &quot;{source}&quot;
      </p>
    );
  }

  // durationVersion (polled in the RAF loop above) triggers a re-render
  // when loadedmetadata fires, so getDuration() returns the real value
  // instead of 0. Without this, saved selections render at x=0 until
  // the first timeupdate event.
  const duration = handle.getDuration();
  const channelCount = handle.channelCount || 1;
  const peaks = handle.peaks;
  const waveformWidth = Math.max(containerWidth - GUTTER_WIDTH, 0);
  const totalBuckets = computeBucketCount(duration, BUCKETS_PER_SECOND);

  // Compute visible bucket range from zoom/viewport
  const visibleDuration = duration > 0 ? duration / zoomLevel : 0;
  const startBucket = Math.floor(viewportStart * BUCKETS_PER_SECOND);
  const endBucket = Math.min(
    Math.ceil((viewportStart + visibleDuration) * BUCKETS_PER_SECOND),
    totalBuckets,
  );

  // Build track labels
  const labels: string[] = [];
  for (let i = 0; i < channelCount; i++) {
    labels.push(trackLabels?.[i] ?? `Track ${String(i)}`);
  }

  const tracksHeight = channelCount * TRACK_HEIGHT;

  // Live preview rectangle for press-and-hold Enter range creation
  // (#268 fix). Re-derived each render from currentTime so the right
  // edge tracks the playhead as the video plays. Null when no hold is
  // in progress.
  const keyboardRangePreview =
    pendingRangeStartTime !== null
      ? {
          start: Math.min(pendingRangeStartTime, currentTime),
          end: Math.max(pendingRangeStartTime, currentTime),
        }
      : null;

  return (
    <div
      ref={containerRef}
      data-testid="timeline"
      data-source={source}
      data-name={name}
      data-selection-type={selectionType}
      data-selection-scope={selectionScope}
      data-multi-select={multiSelect}
      data-show-waveform={showWaveform}
      data-zoom-level={zoomLevel}
      data-viewport-start={viewportStart}
      role="region"
      aria-label={`Timeline: ${name}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => {
        // Drop any in-progress press-and-hold range — focus left the
        // timeline before the matching keyup arrived. (#263)
        pendingRangeStartRef.current = null;
        setPendingRangeStartTime(null);
      }}
      className={containerClass}
      style={{
        border: "1px solid var(--stagebook-border, #e5e7eb)",
        borderRadius: "0.5rem",
        overflow: "hidden",
        // `outline: none` removes the browser default; the scoped
        // `:focus-visible` ring below replaces it. Inline (not in the
        // <style> block) because the ring is a box-shadow override
        // that needs the outline killed unconditionally for both
        // focus and non-focus states.
        outline: "none",
        position: "relative",
      }}
    >
      <style>{`
        /* Container focus ring (#382). The Timeline is tabbable
           (tabIndex={0}) and receives focus programmatically via
           onRequestFocus after selection actions, so keyboard
           shortcuts (arrows, Tab handle-switch, Delete, Enter for
           press-and-hold range creation) become live. Without a
           visible focus indicator, participants doing keyboard
           annotation had no signal that the Timeline was armed.

           Uses :focus (not :focus-visible) because the ring
           communicates "keyboard shortcuts are live" — and that's
           true whether the participant got here by click or by
           Tab. The same hotkey (e.g. Space to play/pause via the
           keyboardActions arbitration with MediaPlayer) is live
           after a mouse click, so the affordance has to match.
           Buttons elsewhere (mute, zoom, help) keep :focus-visible
           because their "armed" state isn't action-relevant — they
           only fire on Space/Enter and most users don't expect a
           click-then-spacebar pattern on a button. */
        .${containerClass}:focus {
          box-shadow: 0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25));
        }
      `}</style>
      {/* Header: zoom controls (always) + minimap (when zoomed in) — puts
          the zoom buttons next to the minimap for context (issue #129). */}
      <TimelineHeader
        zoomLevel={zoomLevel}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        minimap={
          zoomLevel > 1 ? (
            <Minimap
              duration={duration}
              width={waveformWidth}
              zoomLevel={zoomLevel}
              viewportStart={viewportStart}
              currentTime={currentTime}
              selections={state.selections}
              peaks={peaks}
              peaksVersion={peaksVersion}
              totalBuckets={totalBuckets}
              onViewportChange={onMinimapPan}
            />
          ) : null
        }
      />

      {/* Time ruler — offset by gutter width. Click/drag scrubs the
          playhead (standard NLE convention). */}
      <div style={{ marginLeft: `${String(GUTTER_WIDTH)}px` }}>
        <TimeRuler
          duration={duration}
          width={waveformWidth}
          zoomLevel={zoomLevel}
          viewportStart={viewportStart}
          onSeek={(t) => handle.seekTo(t)}
          onDragStart={() => {
            playheadDraggingRef.current = true;
          }}
          onDragEnd={() => {
            playheadDraggingRef.current = false;
            // Reset auto-scroll memory so the post-drag RAF tick doesn't
            // see drag_end_time - 0 as a "jump" and snap-to-25%.
            lastPlayheadRef.current = handleRef.current?.getCurrentTime() ?? 0;
          }}
        />
      </div>

      {/* Tracks + selection overlay + playhead */}
      <div ref={tracksAreaRef} style={{ position: "relative" }}>
        {labels.map((label, i) => (
          <TimelineTrack
            key={i}
            label={label}
            peaks={peaks[i] ?? null}
            peaksVersion={peaksVersion}
            waveformWidth={waveformWidth}
            height={TRACK_HEIGHT}
            startBucket={startBucket}
            endBucket={endBucket}
            muted={handle.isChannelMuted(i)}
            onToggleMute={(nextMuted) => onToggleMute(i, nextMuted)}
          />
        ))}

        {/* Selection overlay — positioned over the waveform area, offset by gutter */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${String(GUTTER_WIDTH)}px`,
            width: `${String(waveformWidth)}px`,
            height: `${String(tracksHeight)}px`,
          }}
        >
          <SelectionOverlay
            width={waveformWidth}
            height={tracksHeight}
            duration={duration}
            zoomLevel={zoomLevel}
            viewportStart={viewportStart}
            selectionType={selectionType}
            selectionScope={selectionScope}
            channelCount={channelCount}
            multiSelect={multiSelect}
            selections={state.selections}
            activeIndex={state.activeIndex}
            activeHandle={state.activeHandle}
            onCreateRange={(start, end, track) =>
              dispatch({
                type: "CREATE_RANGE",
                start,
                end,
                track,
                multiSelect,
              })
            }
            onCreatePoint={(time, track) =>
              dispatch({
                type: "CREATE_POINT",
                time,
                track,
                multiSelect,
              })
            }
            onAdjustHandle={(index, h, time, noSnapshot) =>
              dispatch({
                type: "ADJUST_HANDLE",
                index,
                handle: h,
                time,
                noSnapshot,
              })
            }
            onRepositionPoint={(index, time, noSnapshot) =>
              dispatch({
                type: "REPOSITION_POINT",
                index,
                time,
                noSnapshot,
              })
            }
            onSelect={(index) => dispatch({ type: "SELECT", index })}
            onDeselect={() => dispatch({ type: "DESELECT" })}
            onSetActiveHandle={(h) =>
              dispatch({ type: "SET_ACTIVE_HANDLE", handle: h })
            }
            onBeginDrag={() => {
              dispatch({ type: "BEGIN_DRAG" });
              setIsDragging(true);
            }}
            onEndDrag={() => setIsDragging(false)}
            onRequestFocus={() =>
              containerElRef.current?.focus({ preventScroll: true })
            }
            keyboardRangePreview={keyboardRangePreview}
            pulseTrigger={pulseTrigger}
            onBlockedCreate={triggerBlockedPulse}
          />

          {/* Playhead — over selection overlay, extends into ruler via negative top */}
          <Playhead
            currentTime={currentTime}
            duration={duration}
            width={waveformWidth}
            height={tracksHeight}
            rulerHeight={RULER_HEIGHT}
            zoomLevel={zoomLevel}
            viewportStart={viewportStart}
            onSeek={(t) => handle.seekTo(t)}
            onDragStart={() => {
              playheadDraggingRef.current = true;
            }}
            onDragEnd={() => {
              playheadDraggingRef.current = false;
              lastPlayheadRef.current =
                handleRef.current?.getCurrentTime() ?? 0;
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <TimelineFooter
        selectionType={selectionType}
        selections={state.selections}
        activeIndex={state.activeIndex}
        onHelpToggle={() => setHelpOpen((v) => !v)}
        helpOpen={helpOpen}
        helpButtonRef={helpButtonRef}
        singleSelectFull={
          selectionType === "range" &&
          !multiSelect &&
          state.selections.length > 0
        }
      />

      {/* Help popover */}
      {helpOpen && (
        <HelpPopover
          selectionType={selectionType}
          onClose={() => setHelpOpen(false)}
          buttonRef={helpButtonRef}
        />
      )}
    </div>
  );
}
