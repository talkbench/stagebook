// State management for Timeline selections.
// Pure reducer wrapping selections.ts functions, with undo support.
//
// Pure TypeScript — no React/DOM deps. Used by Timeline.tsx via useReducer.

import {
  type RangeSelection,
  type TimelineValue,
  type SelectionSnapshot,
  createRange,
  createPoint,
  adjustHandle,
  repositionPoint,
  deleteSelection,
  sortRanges,
  sortPoints,
  pushUndo,
  popUndo,
  roundMs,
} from "./selections.js";

export interface SelectionState {
  selections: TimelineValue;
  activeIndex: number | null;
  activeHandle: "start" | "end" | null;
  undoStack: SelectionSnapshot[];
}

export function initialSelectionState(): SelectionState {
  return {
    selections: [],
    activeIndex: null,
    activeHandle: null,
    undoStack: [],
  };
}

export type SelectionAction =
  | {
      type: "CREATE_RANGE";
      start: number;
      end: number;
      track: number | undefined;
      multiSelect: boolean;
    }
  | {
      type: "CREATE_POINT";
      time: number;
      track: number | undefined;
      multiSelect: boolean;
    }
  | {
      type: "ADJUST_HANDLE";
      index: number;
      handle: "start" | "end";
      time: number;
      /**
       * If true, the reducer updates selections without pushing an undo
       * snapshot. SelectionOverlay uses this for live drag pointermove
       * events so that an entire drag collapses into a single undo step.
       */
      noSnapshot?: boolean;
    }
  | {
      type: "REPOSITION_POINT";
      index: number;
      time: number;
      noSnapshot?: boolean;
    }
  /**
   * Pushes a snapshot of the current selections to the undo stack without
   * changing them. Dispatched at the start of a drag (after the dead zone)
   * so undo restores the pre-drag state in one step.
   */
  | { type: "BEGIN_DRAG" }
  | { type: "DELETE" }
  | { type: "SELECT"; index: number }
  | { type: "DESELECT" }
  | { type: "SET_ACTIVE_HANDLE"; handle: "start" | "end" | null }
  | { type: "UNDO" }
  | { type: "CANCEL_EDIT"; before: SelectionState }
  | { type: "REPLACE_ALL"; selections: TimelineValue };

function isRangeArray(s: TimelineValue): s is RangeSelection[] {
  return s.length === 0 || "start" in s[0];
}

function snapshot(state: SelectionState): SelectionState {
  return {
    ...state,
    undoStack: pushUndo(state.undoStack, state.selections),
  };
}

export function selectionsReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case "CANCEL_EDIT":
      // Restore both the answer and its undo history; a canceled gesture
      // must not reappear through a later undo.
      return action.before;
    case "CREATE_RANGE": {
      // multiSelect: false → preserve any existing range. The user must
      // explicitly delete the existing range to make a new one. This
      // mirrors the no-op behavior of click-without-drag (SelectionOverlay)
      // and Enter press-and-hold (Timeline). Visual feedback (pulse on the
      // existing range, footer hint) lives at the call sites — the reducer
      // is the authoritative gate.
      if (!action.multiSelect) {
        const hasExistingRange =
          isRangeArray(state.selections) && state.selections.length > 0;
        if (hasExistingRange) return state;
        const lo = roundMs(Math.min(action.start, action.end));
        const hi = roundMs(Math.max(action.start, action.end));
        if (hi <= lo) return state;
        const range: RangeSelection = { start: lo, end: hi };
        if (action.track !== undefined) range.track = action.track;
        return {
          ...snapshot(state),
          selections: [range],
          activeIndex: 0,
          activeHandle: null,
        };
      }
      const existing = isRangeArray(state.selections) ? state.selections : [];
      const range = createRange(
        action.start,
        action.end,
        action.track,
        existing,
      );
      if (!range) return state;
      const next = sortRanges([...existing, range]);
      return {
        ...snapshot(state),
        selections: next,
        activeIndex: next.indexOf(range),
        activeHandle: null,
      };
    }

    case "CREATE_POINT": {
      // multiSelect: false → the new point REPLACES any existing one.
      if (!action.multiSelect) {
        const point = createPoint(action.time, action.track);
        return {
          ...snapshot(state),
          selections: [point],
          activeIndex: 0,
          activeHandle: null,
        };
      }
      const existing = !isRangeArray(state.selections) ? state.selections : [];
      const point = createPoint(action.time, action.track);
      const next = sortPoints([...existing, point]);
      return {
        ...snapshot(state),
        selections: next,
        activeIndex: next.indexOf(point),
        activeHandle: null,
      };
    }

    case "ADJUST_HANDLE": {
      if (!isRangeArray(state.selections)) return state;
      const next = adjustHandle(
        state.selections,
        action.index,
        action.handle,
        action.time,
      );
      const base = action.noSnapshot ? state : snapshot(state);
      return {
        ...base,
        selections: sortRanges(next),
        activeHandle: action.handle,
      };
    }

    case "REPOSITION_POINT": {
      if (isRangeArray(state.selections)) return state;
      const next = repositionPoint(state.selections, action.index, action.time);
      const base = action.noSnapshot ? state : snapshot(state);
      return {
        ...base,
        selections: sortPoints(next),
      };
    }

    case "BEGIN_DRAG": {
      return snapshot(state);
    }

    case "DELETE": {
      if (state.activeIndex === null) return state;
      const next = deleteSelection(
        state.selections as RangeSelection[],
        state.activeIndex,
      );
      return {
        ...snapshot(state),
        selections: next,
        activeIndex: null,
        activeHandle: null,
      };
    }

    case "SELECT": {
      return {
        ...state,
        activeIndex: action.index,
        activeHandle: null,
      };
    }

    case "DESELECT": {
      return {
        ...state,
        activeIndex: null,
        activeHandle: null,
      };
    }

    case "SET_ACTIVE_HANDLE": {
      return {
        ...state,
        activeHandle: action.handle,
      };
    }

    case "UNDO": {
      const result = popUndo(state.undoStack);
      if (!result) return state;
      return {
        ...state,
        selections: result.restored,
        undoStack: result.newStack,
        activeIndex: null,
        activeHandle: null,
      };
    }

    case "REPLACE_ALL": {
      // Guard against malformed input from future consumers (e.g., saved
      // state rehydration) — better to ignore than crash downstream in
      // clampToFreeGap, adjustHandle, etc. which assume numeric fields.
      if (!Array.isArray(action.selections)) return state;
      return {
        ...snapshot(state),
        selections: action.selections,
      };
    }
  }
}
