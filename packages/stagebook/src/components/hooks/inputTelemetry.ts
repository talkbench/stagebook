import {
  TYPING_INPUT_TYPES,
  type InputStats,
  type TypingInputType,
} from "../../utils/promptTelemetry.js";

export const LARGE_INSERTION_CHARS = 20;
export const MAX_LARGE_INSERTIONS = 10;
export const INPUT_KEYDOWN_WINDOW_MS = 50;

const knownInputTypes: ReadonlySet<string> = new Set(TYPING_INPUT_TYPES);
function inputType(type: string | undefined): TypingInputType {
  return type && knownInputTypes.has(type)
    ? (type as TypingInputType)
    : "other";
}

type Field = HTMLInputElement | HTMLTextAreaElement;
export interface TelemetryKeyEvent {
  key: string;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
}
interface BeforeInput {
  event: InputEvent;
  value: string;
  start: number;
  end: number;
}

/** Minimal single-edit estimate when the browser did not expose its range. */
function changedLengths(previous: string, next: string) {
  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  )
    start++;
  let end = previous.length;
  let nextEnd = next.length;
  while (
    end > start &&
    nextEnd > start &&
    previous[end - 1] === next[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  return { inserted: nextEnd - start, deleted: end - start };
}

/**
 * Native-input observations only. No scheduling, writes, or response mutation.
 * Values/ranges exist briefly to measure edits, never in exported snapshots.
 */
export function createInputTelemetry() {
  const stats: InputStats = {
    inputEventCount: 0,
    beforeInputEventCount: 0,
    inputTypeCounts: {},
    charsInsertedByInputType: {},
    charsInsertedTotal: 0,
    charsDeletedTotal: 0,
    maxSingleInsertionChars: 0,
    largeInsertionCount: 0,
    largeInsertions: [],
    untrustedInputEventCount: 0,
    inputWithoutKeydownCount: 0,
    inputEventsWithoutBeforeInput: 0,
    inputEventsWithoutData: 0,
    inputDiffFallbackCount: 0,
    unidentifiedKeyCount: 0,
    processKeyCount: 0,
    compositionCount: 0,
    shortcutKeyCount: 0,
    copyCount: 0,
    cutCount: 0,
    firstInputDelayMs: null,
    totalInputTimeMs: null,
  };
  let previous = "";
  let before: BeforeInput | undefined;
  let composing = false;
  let firstFocusAt: number | null = null;
  let lastFocusAt: number | null = null;
  let lastKeydownAt: number | null = null;
  let firstInputAt: number | null = null;

  const syncValue = (value: string) => {
    if (value !== previous) before = undefined;
    previous = value;
  };
  const focus = (now: number) => {
    firstFocusAt ??= now;
    lastFocusAt = now;
    before = undefined;
  };
  const keydown = (event: TelemetryKeyEvent, now: number, counted: boolean) => {
    lastKeydownAt = now;
    before = undefined;
    if (
      event.key === "Unidentified" ||
      (event.keyCode === 229 &&
        !composing &&
        !event.isComposing &&
        !event.nativeEvent?.isComposing)
    ) {
      stats.unidentifiedKeyCount++;
    }
    if (event.key === "Process") stats.processKeyCount++;
    if (counted && (event.ctrlKey || event.metaKey)) stats.shortcutKeyCount++;
  };
  const beforeInput = (event: InputEvent, field: Field) => {
    stats.beforeInputEventCount++;
    previous = field.value;
    before = {
      event,
      value: previous,
      start: field.selectionStart ?? 0,
      end: field.selectionEnd ?? 0,
    };
  };
  const input = (event: InputEvent, field: Field, now: number) => {
    const type = inputType(event.inputType);
    const next = field.value;
    // Inspect cancellation after all beforeinput handlers ran. In particular,
    // NumericInput can cancel and apply a filtered edit without an input event.
    const context =
      before &&
      !before.event.defaultPrevented &&
      before.event.inputType === event.inputType &&
      before.value === previous
        ? before
        : undefined;
    before = undefined;
    stats.inputEventCount++;
    stats.inputTypeCounts[type] = (stats.inputTypeCounts[type] ?? 0) + 1;
    if (!context) stats.inputEventsWithoutBeforeInput++;
    if (event.data == null) stats.inputEventsWithoutData++;
    if (!event.isTrusted) stats.untrustedInputEventCount++;

    // A compatible pre-edit selection identifies replacements, even when the
    // value length or content stays identical. Composition updates frequently
    // replace text outside that selection, so they use the value diff instead.
    let lengths: { inserted: number; deleted: number } | undefined;
    if (
      context &&
      (next !== previous ||
        event.data != null ||
        event.inputType?.startsWith("insert"))
    ) {
      const prefix = previous.slice(0, context.start);
      const suffix = previous.slice(context.end);
      const inserted = next.length - prefix.length - suffix.length;
      if (inserted >= 0 && next.startsWith(prefix) && next.endsWith(suffix)) {
        const actual = next.slice(prefix.length, prefix.length + inserted);
        if (event.data == null || actual === event.data) {
          lengths = { inserted, deleted: context.end - context.start };
        }
      }
    }
    if (!lengths) {
      lengths = changedLengths(previous, next);
      stats.inputDiffFallbackCount++;
    }
    previous = next;
    stats.charsInsertedTotal += lengths.inserted;
    stats.charsDeletedTotal += lengths.deleted;
    if (lengths.inserted > 0) {
      stats.charsInsertedByInputType[type] =
        (stats.charsInsertedByInputType[type] ?? 0) + lengths.inserted;
    }
    stats.maxSingleInsertionChars = Math.max(
      stats.maxSingleInsertionChars,
      lengths.inserted,
    );
    if (firstInputAt === null) {
      firstInputAt = now;
      stats.firstInputDelayMs =
        firstFocusAt === null ? null : now - firstFocusAt;
    } else {
      stats.totalInputTimeMs = now - firstInputAt;
    }
    const msSinceLastKeydown =
      lastKeydownAt === null ? null : now - lastKeydownAt;
    const precededByKeydown =
      msSinceLastKeydown !== null &&
      msSinceLastKeydown >= 0 &&
      msSinceLastKeydown <= INPUT_KEYDOWN_WINDOW_MS;
    if (!precededByKeydown) stats.inputWithoutKeydownCount++;
    if (lengths.inserted >= LARGE_INSERTION_CHARS) {
      stats.largeInsertionCount++;
      if (stats.largeInsertions.length < MAX_LARGE_INSERTIONS) {
        stats.largeInsertions.push({
          timestamp: now,
          msSinceFirstFocus: firstFocusAt === null ? null : now - firstFocusAt,
          msSinceLastFocus: lastFocusAt === null ? null : now - lastFocusAt,
          msSinceLastKeydown,
          chars: lengths.inserted,
          inputType: type,
          isTrusted: event.isTrusted,
          isComposing: composing || event.isComposing === true,
          precededByKeydown,
        });
      }
    }
  };
  return {
    syncValue,
    focus,
    keydown,
    beforeInput,
    input,
    blur: () => {
      before = undefined;
    },
    compositionStart: () => {
      composing = true;
      before = undefined;
    },
    compositionEnd: () => {
      if (composing) stats.compositionCount++;
      composing = false;
      // Firefox can dispatch the matching input after compositionend. Keep its
      // pre-edit selection; input still checks cancellation/type/value, and a
      // new key, focus, blur, composition or rebase discards stale context.
    },
    copy: () => {
      stats.copyCount++;
    },
    cut: () => {
      stats.cutCount++;
    },
    snapshot: (): InputStats => ({
      ...stats,
      inputTypeCounts: { ...stats.inputTypeCounts },
      charsInsertedByInputType: { ...stats.charsInsertedByInputType },
      largeInsertions: stats.largeInsertions.map((sample) => ({ ...sample })),
    }),
  };
}
