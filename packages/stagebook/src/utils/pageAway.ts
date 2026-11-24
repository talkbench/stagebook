/**
 * What "away from the page" means (#845).
 *
 * One definition shared by MediaPlayer's automatic pause (#844) and by hosts
 * that record time away across a session, so the two records agree on when a
 * participant was away. This module decides what counts as away and reads the
 * page state. It builds no episodes and keeps no totals; that is the caller's.
 *
 * Focus is read from `document.hasFocus()`, never inferred from which event
 * fired. `hasFocus()` stays true while focus is inside a frame on the page,
 * such as a YouTube player's own controls, whereas the window's `blur` fires
 * when focus moves into such a frame.
 */

/**
 * The ways of being away. `hidden`: the page is not visible, for example
 * because another tab is in front. `unfocused`: the page lacks focus, for
 * example because a window beside it has focus. A hidden page also lacks
 * focus.
 */
export const AWAY_TRIGGERS = ["hidden", "unfocused"] as const;
export type AwayTrigger = (typeof AWAY_TRIGGERS)[number];

/** An absence shorter than this is counted but not logged. */
export const AWAY_LOG_THRESHOLD_MS = 1000;

export interface PageState {
  hidden: boolean;
  /** `document.hasFocus()`: true while focus is in a frame on the page. */
  focused: boolean;
}

type Listenable = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** The parts of a `Document` read here; a real `document` satisfies it. */
export interface PageDocument extends Listenable {
  readonly visibilityState: string;
  hasFocus(): boolean;
  readonly defaultView: Listenable | null;
}

/**
 * Why the page counts as away, or null when it doesn't. `triggers` defaults
 * to both. `unfocused` also covers a hidden page, reported as the more
 * specific `hidden`; `hidden` alone ignores a visible page without focus.
 */
export function awayReason(
  page: PageState,
  triggers: readonly AwayTrigger[] = AWAY_TRIGGERS,
): AwayTrigger | null {
  if (triggers.length === 0) return null;
  if (page.hidden) return "hidden";
  if (!page.focused && triggers.includes("unfocused")) return "unfocused";
  return null;
}

/** The page's current visibility and focus. */
export function readPageState(
  doc: Pick<PageDocument, "visibilityState" | "hasFocus">,
): PageState {
  return { hidden: doc.visibilityState === "hidden", focused: doc.hasFocus() };
}

/**
 * Calls `onChange` with the page state whenever visibility or focus may have
 * changed, until the returned function is called. The state may be the same
 * as last time; callers that need changes only compare it themselves.
 *
 * After the window's `blur` the state is read a task later: engines differ
 * on whether focus moving into a frame on the page shows in `hasFocus()`
 * during the blur itself.
 */
export function watchPageState(
  doc: PageDocument,
  onChange: (page: PageState, event: Event) => void,
): () => void {
  const win = doc.defaultView;
  const report = (event: Event) => onChange(readPageState(doc), event);
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const blur = (event: Event) => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => report(event), 0);
  };
  doc.addEventListener("visibilitychange", report);
  win?.addEventListener("blur", blur);
  win?.addEventListener("focus", report);
  return () => {
    clearTimeout(blurTimer);
    doc.removeEventListener("visibilitychange", report);
    win?.removeEventListener("blur", blur);
    win?.removeEventListener("focus", report);
  };
}
