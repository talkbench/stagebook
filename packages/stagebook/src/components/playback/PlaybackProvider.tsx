import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PlaybackHandle } from "./PlaybackHandle.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PlaybackRegistry {
  handles: Map<string, PlaybackHandle>;
  register: (name: string, handle: PlaybackHandle) => void;
  unregister: (name: string) => void;
  /** Mark `name` as the active player — the target of the global Space
   *  handler when no focused element handles the press first. Components
   *  call this on `mousedown` to attribute "what the user is interacting
   *  with" so subsequent off-player Space presses still toggle the right
   *  one. Unknown names are accepted (and silently fall back to the last
   *  registered handle) so the caller doesn't have to guard. */
  markActive: (name: string) => void;
  /** Name passed to the most recent `markActive`, or null if never called. */
  activeName: string | null;
}

const PlaybackContext = createContext<PlaybackRegistry | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const [handles, setHandles] = useState<Map<string, PlaybackHandle>>(
    () => new Map(),
  );

  const register = useCallback((name: string, handle: PlaybackHandle) => {
    setHandles((prev) => {
      if (prev.get(name) === handle) return prev;
      return new Map(prev).set(name, handle);
    });
  }, []);

  const unregister = useCallback((name: string) => {
    setHandles((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const [activeName, setActiveName] = useState<string | null>(null);
  const markActive = useCallback((name: string) => {
    setActiveName(name);
  }, []);

  const value = useMemo(
    () => ({ handles, register, unregister, markActive, activeName }),
    [handles, register, unregister, markActive, activeName],
  );

  // Global play/pause hotkeys → toggle the active player (issue #300).
  // The Timeline and MediaPlayer wrappers already handle Space (and K)
  // when focused, but focus often lands on the page body (or another
  // non-capturing element) after the user clicks "play" and then moves
  // on — there, the browser's default Space=scroll fires and the page
  // jumps. This window-level fallback catches Space and K anywhere on
  // the page so the user's intent ("pause what's playing") works
  // regardless of where focus happens to be.
  //
  // Scope is intentionally narrow — only the play/pause toggle keys.
  // Seek/scrub keys (J, L, arrows, comma, period) stay focus-required
  // because they overlap with page navigation and aren't subject to the
  // same Space=scroll surprise.
  //
  // Target selection:
  // - The "active" player (last one whose wrapper or sibling Timeline was
  //   clicked, via `markActive`). This matches user intent on multi-player
  //   pages: clicking on a player marks it as the hotkey target.
  // - Falls back to the most recently registered handle when nothing has
  //   been clicked yet, so a single-player page works without ceremony.
  //
  // Skip rules:
  // - Modifier keys: reserved for OS / app shortcuts.
  // - Text inputs / contenteditable: Space and K are for typing.
  // - `defaultPrevented`: an inner handler (Timeline, MediaPlayer, button)
  //   already consumed the press; running again would double-toggle.
  useEffect(() => {
    if (handles.size === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const isToggleKey = e.key === " " || e.key === "k" || e.key === "K";
      if (!isToggleKey) return;
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "input, textarea, select, [contenteditable=''], [contenteditable='true']",
        )
      ) {
        return;
      }
      let pick: PlaybackHandle | undefined =
        activeName !== null ? handles.get(activeName) : undefined;
      if (!pick) {
        // Fallback: most recently registered handle. Map iteration is
        // insertion-ordered, so the last value is the freshest.
        for (const h of handles.values()) pick = h;
      }
      if (!pick) return;
      e.preventDefault();
      if (pick.isPaused()) pick.play();
      else pick.pause();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handles, activeName]);

  return (
    <PlaybackContext.Provider value={value}>
      {children}
    </PlaybackContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Register a PlaybackHandle under `name` for the duration of the component's
 * life. Safe to call without a PlaybackProvider — silently no-ops.
 */
export function useRegisterPlayback(
  name: string,
  handle: PlaybackHandle,
): void {
  const ctx = useContext(PlaybackContext);
  // Extract the stable callbacks so the effect depends on them directly
  // rather than on the full context object (which changes whenever handles
  // state updates). register/unregister are useCallback([]) so they only
  // change if a different PlaybackProvider instance is mounted.
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  useEffect(() => {
    if (!register || !unregister) return; // no PlaybackProvider — no-op
    register(name, handle);
    return () => unregister(name);
  }, [name, handle, register, unregister]);
}

/**
 * Look up a PlaybackHandle by the name registered by a sibling MediaPlayer.
 * Returns `undefined` if no player with that name is mounted yet.
 * Must be called inside a PlaybackProvider.
 */
export function usePlayback(source: string): PlaybackHandle | undefined {
  const ctx = useContext(PlaybackContext);
  return ctx?.handles.get(source);
}

/**
 * Returns a callback that marks a player as the active target for the
 * global Space handler (#300). Call on user interaction (e.g. mousedown
 * on the MediaPlayer wrapper or its sibling Timeline) so subsequent
 * off-player Space presses pause/resume the right one.
 *
 * Safe to call without a PlaybackProvider — returns a no-op.
 */
export function useMarkActive(): (name: string) => void {
  const ctx = useContext(PlaybackContext);
  return ctx?.markActive ?? noop;
}

/**
 * True when `name` is the active Space target *and* there's more than
 * one player on the page, so callers know whether to render a subtle
 * "this is what Space will toggle" indicator. Single-player pages always
 * return false — the cue would be redundant noise there.
 */
export function useIsActiveSpaceTarget(name: string): boolean {
  const ctx = useContext(PlaybackContext);
  if (!ctx) return false;
  if (ctx.handles.size <= 1) return false;
  return ctx.activeName === name;
}

function noop() {}
