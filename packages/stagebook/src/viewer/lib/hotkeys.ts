import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Researcher-facing keyboard shortcuts for the viewer chrome. See the design in
 * https://github.com/talkbench/stagebook/issues/534.
 *
 * The Alt/Option modifier is a **namespace separator**: bare keys pass through
 * to the study content (the participant experience — move a radio, type into a
 * Prompt, drag a Slider), while `Alt+<key>` drives the researcher chrome
 * (switch treatment, advance step, jump position, timer). This keeps the two
 * roles unambiguous and focus-independent, so we need no "am I focused in a
 * text field?" heuristics.
 */
export interface ViewerHotkeyHandlers {
  /** Alt+ArrowLeft — previous step. */
  onPrevStep: () => void;
  /** Alt+ArrowRight — next step. */
  onNextStep: () => void;
  /** Alt+ArrowUp — previous treatment/unit. */
  onPrevTreatment: () => void;
  /** Alt+ArrowDown — next treatment/unit. */
  onNextTreatment: () => void;
  /** Alt+0..9 — select that player position (ignored if out of range). */
  onSelectPosition: (index: number) => void;
  /** Alt+K — play/pause the timeline scrubber. */
  onToggleTimer: () => void;
  /** Alt+/ (or Alt+?) — toggle the shortcut cheatsheet. */
  onToggleHelp: () => void;
  /**
   * Alt+P — focus the "part to preview" picker. Treatments are a flat,
   * name-keyed set (no meaningful order), so blind Alt+↑/↓ cycling can't show
   * the whole list; focusing the native <select> gives typeahead-by-name and
   * the OS dropdown for browsing. See issue #534.
   */
  onFocusPicker: () => void;
}

/** "Digit0".."Digit9" → 0..9; anything else → null. */
function digitFromCode(code: string): number | null {
  const m = /^Digit([0-9])$/.exec(code);
  return m ? Number(m[1]) : null;
}

/**
 * Route one keydown to the matching researcher action. Returns `true` (and
 * calls `preventDefault`) when the event was one of ours, `false` otherwise.
 *
 * Keying off `event.code` (the physical key) rather than `event.key` is
 * deliberate and load-bearing: on macOS, holding Option composes the character
 * (`Option+K` → `"˚"`, `Option+3` → `"£"`), so `event.key` is unreliable while
 * `event.code` ("KeyK", "Digit3") stays stable and layout-independent.
 */
export function dispatchViewerHotkey(
  e: KeyboardEvent,
  handlers: ViewerHotkeyHandlers,
): boolean {
  // Only Alt-modified keys are ours. Bail on Ctrl/Meta so we never shadow a
  // native accelerator (Cmd/Ctrl+R reload, Cmd/Ctrl+digit tab switch) and so
  // Windows AltGr (which reports as Ctrl+Alt) still types characters.
  if (!e.altKey || e.ctrlKey || e.metaKey) return false;

  let handled = true;
  switch (e.code) {
    case "ArrowLeft":
      handlers.onPrevStep();
      break;
    case "ArrowRight":
      handlers.onNextStep();
      break;
    case "ArrowUp":
      handlers.onPrevTreatment();
      break;
    case "ArrowDown":
      handlers.onNextTreatment();
      break;
    case "KeyK":
      handlers.onToggleTimer();
      break;
    case "KeyP":
      handlers.onFocusPicker();
      break;
    case "Slash":
      // Alt+/ and Alt+? (Shift+Slash) both land here.
      handlers.onToggleHelp();
      break;
    default: {
      const digit = digitFromCode(e.code);
      if (digit !== null) {
        handlers.onSelectPosition(digit);
      } else {
        handled = false;
      }
    }
  }

  if (handled) e.preventDefault();
  return handled;
}

/**
 * Attach the researcher hotkeys to a viewer instance. Returns a callback ref to
 * put on the viewer's root element; the listener lives on that node (not
 * `window`), so shortcuts only fire when focus is within this viewer — polite
 * when several viewers, or other page content, share the document.
 *
 * `handlers` may be recreated every render; the latest set is always used
 * without re-subscribing.
 */
export function useViewerHotkeys(
  handlers: ViewerHotkeyHandlers,
  enabled = true,
): (node: HTMLElement | null) => void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Track the mounted node in state (not a plain ref) so the effect re-runs if
  // the viewer swaps its root element (e.g. empty-state ↔ normal render).
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || !node) return;
    const onKeyDown = (e: KeyboardEvent) =>
      dispatchViewerHotkey(e, handlersRef.current);
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [node, enabled]);

  return useCallback((n: HTMLElement | null) => setNode(n), []);
}
