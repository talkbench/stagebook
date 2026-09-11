// Pure key-to-action mapping for Timeline keyboard editing.
// No React/DOM deps — used by Timeline.tsx's keydown handler.
//
// IMPORTANT: This is the arbitration point between Timeline and MediaPlayer.
// Returning `null` means "fall through to MediaPlayer". Returning an action
// means "the timeline handles this; preventDefault + stopPropagation".

/** Frame step for comma/period: 1/30s ≈ one video frame at 30fps. */
export const FRAME_STEP = 1 / 30;

/** Adjustment in seconds for arrow keys. */
const ARROW_STEP = 1;

export interface KeyContext {
  selectionType: "range" | "point";
  activeIndex: number | null;
  /** Range mode only: which handle is currently active. */
  activeHandle: "start" | "end" | null;
  /** Range mode only: the currently active range, if any. */
  currentRange: { start: number; end: number } | null;
  /** Point mode only: the currently active point, if any. */
  currentPoint: { time: number } | null;
}

export type KeyAction =
  | {
      type: "adjustHandle";
      index: number;
      handle: "start" | "end";
      time: number;
    }
  | { type: "repositionPoint"; index: number; time: number }
  | { type: "switchHandle"; handle: "start" | "end" }
  | { type: "selectAdjacent"; direction: -1 | 1 }
  | { type: "delete" }
  | { type: "deselect" }
  | { type: "undo" }
  | { type: "togglePlayPause" }
  | { type: "seekPlayhead"; delta: number }
  /** Point mode, Enter keydown: create a point at the current playhead. */
  | { type: "createPointAtPlayhead" }
  /** Range mode, Enter keydown: stash the current playhead as a pending
   *  range-start. Timeline.tsx tracks the pending start in a ref until
   *  the matching keyup arrives. */
  | { type: "beginRangeAtPlayhead" }
  /** Range mode, Enter keyup: commit the range from the pending start to
   *  the current playhead. */
  | { type: "endRangeAtPlayhead" };

/** Subset of KeyboardEvent that we care about — easier to test. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Browser auto-repeat flag — true on the 2nd+ keydown of a held key. */
  repeat?: boolean;
}

/**
 * Map a keyboard event + selection context to an action, or null if the
 * event should fall through to the MediaPlayer.
 *
 * Rules:
 * - K, J, L are NEVER intercepted (always belong to MediaPlayer)
 * - Space toggles play/pause (handled by Timeline, not MediaPlayer,
 *   because Timeline has focus during annotation)
 * - Ctrl+Z / Cmd+Z (without Shift) is undo, even when no selection is active
 * - Arrow/comma/period with an active selection adjust the handle/point
 * - Arrow/comma/period WITHOUT an active selection scrub the playhead
 */
export function keyToAction(
  e: KeyEventLike,
  ctx: KeyContext,
): KeyAction | null {
  // Never intercept MediaPlayer-specific shortcuts.
  if (e.key === "k" || e.key === "K") return null;
  if (e.key === "j" || e.key === "J" || e.key === "l" || e.key === "L")
    return null;

  // Space: toggle play/pause. Handled here (not fall-through) because
  // when the timeline has focus, MediaPlayer doesn't receive key events.
  if (e.key === " ") return { type: "togglePlayPause" };

  // Undo works regardless of active selection.
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    (e.key === "z" || e.key === "Z")
  ) {
    return { type: "undo" };
  }

  // Enter: real-time annotation. Point mode → tap to create a point at
  // the playhead; range mode → keydown stashes a pending start for a
  // press-and-hold range (the matching keyup is handled by
  // `keyUpToAction`). Available regardless of active selection so users
  // can keep adding marks without explicitly deselecting first.
  //
  // Filter rules:
  // - Auto-repeat (`e.repeat`): ignore. One press = one mark; a held
  //   Enter shouldn't spam dozens of points or reset the range start.
  // - Any modifier: ignore. Reserved for future bindings (Shift+Enter,
  //   Cmd+Enter, etc.).
  if (
    e.key === "Enter" &&
    !e.repeat &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !e.altKey
  ) {
    return ctx.selectionType === "point"
      ? { type: "createPointAtPlayhead" }
      : { type: "beginRangeAtPlayhead" };
  }

  // Focus-scoped character shortcuts; leave modified browser/OS keys alone.
  if (
    (e.key === "[" || e.key === "]") &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey
  ) {
    return { type: "selectAdjacent", direction: e.key === "[" ? -1 : 1 };
  }

  // No active selection: arrow/comma/period scrub the playhead. Skip when
  // Alt is held so browser/OS shortcuts (e.g. Alt+Left history navigation)
  // still work.
  if (ctx.activeIndex === null) {
    if (e.altKey) return null;
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -ARROW_STEP;
    else if (e.key === "ArrowRight") delta = ARROW_STEP;
    else if (e.key === ",") delta = -FRAME_STEP;
    else if (e.key === ".") delta = FRAME_STEP;
    if (delta !== 0) return { type: "seekPlayhead", delta };
    return null;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    return { type: "delete" };
  }

  if (e.key === "Escape") {
    return { type: "deselect" };
  }

  // Range mode: arrows + comma/period adjust the active handle.
  if (ctx.selectionType === "range" && ctx.currentRange) {
    if (e.key === "Tab") {
      const next: "start" | "end" =
        ctx.activeHandle === "start" ? "end" : "start";
      // No active handle: default to end (the most common adjustment target)
      const handle = ctx.activeHandle === null ? "end" : next;
      return { type: "switchHandle", handle };
    }

    if (ctx.activeHandle === null) return null;

    let delta = 0;
    if (e.key === "ArrowLeft") delta = -ARROW_STEP;
    else if (e.key === "ArrowRight") delta = ARROW_STEP;
    else if (e.key === ",") delta = -FRAME_STEP;
    else if (e.key === ".") delta = FRAME_STEP;
    else return null;

    const currentTime =
      ctx.activeHandle === "start"
        ? ctx.currentRange.start
        : ctx.currentRange.end;
    return {
      type: "adjustHandle",
      index: ctx.activeIndex,
      handle: ctx.activeHandle,
      time: currentTime + delta,
    };
  }

  // Point mode: arrows + comma/period reposition the active point.
  if (ctx.selectionType === "point" && ctx.currentPoint) {
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -ARROW_STEP;
    else if (e.key === "ArrowRight") delta = ARROW_STEP;
    else if (e.key === ",") delta = -FRAME_STEP;
    else if (e.key === ".") delta = FRAME_STEP;
    else return null;

    return {
      type: "repositionPoint",
      index: ctx.activeIndex,
      time: ctx.currentPoint.time + delta,
    };
  }

  return null;
}

/**
 * Map a keyup event to a Timeline action. Today the only keyup we care
 * about is Enter in range mode (the press-and-hold range commit). All
 * other keys release without doing anything.
 */
export function keyUpToAction(
  e: KeyEventLike,
  ctx: KeyContext,
): KeyAction | null {
  if (
    e.key === "Enter" &&
    ctx.selectionType === "range" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !e.altKey
  ) {
    return { type: "endRangeAtPlayhead" };
  }
  return null;
}
