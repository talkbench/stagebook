import { useLayoutEffect, useRef, type RefObject } from "react";
import type {
  PointerClickSample,
  PointerControlType,
  PointerFieldState,
  PointerFocusSample,
  PointerPosition,
  PointerSource,
  PointerStats,
  TelemetryPointerType,
} from "../../utils/pointerTelemetry.js";
import { pointerPosition, pointerRegion } from "./pointerGeometry.js";
import { matchesPointerClick } from "./pointerEventMatching.js";

const SAMPLE_LIMIT = 20;
const POINTER_MAX_AGE_MS = 30_000;
const KEY_MAX_AGE_MS = 2_000;
const sourceCounts = () => ({ pointer: 0, keyboard: 0, unknown: 0 });

function emptyStats(controlType: PointerControlType): PointerStats {
  return {
    version: 1,
    controlType,
    clickCount: 0,
    clickCountsBySource: sourceCounts(),
    clickCountsByPointerType: { mouse: 0, touch: 0, pen: 0, unknown: 0 },
    clickSamples: [],
    focusCount: 0,
    focusCountsBySource: sourceCounts(),
    focusSamples: [],
  };
}

function cloneSample<T extends PointerClickSample>(sample: T): T {
  return {
    ...sample,
    position: sample.position && { ...sample.position },
    controlPosition: sample.controlPosition && { ...sample.controlPosition },
    fieldState: sample.fieldState && { ...sample.fieldState },
  };
}

function snapshot(stats: PointerStats): PointerStats {
  return {
    ...stats,
    clickCountsBySource: { ...stats.clickCountsBySource },
    clickCountsByPointerType: { ...stats.clickCountsByPointerType },
    focusCountsBySource: { ...stats.focusCountsBySource },
    clickSamples: stats.clickSamples.map(cloneSample),
    focusSamples: stats.focusSamples.map(cloneSample),
  };
}

interface Target {
  control: HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement;
  box: HTMLElement;
  part: PointerClickSample["targetPart"];
  label: HTMLLabelElement | null;
  optionIndex: number | null;
}

function resolveTarget(
  root: HTMLElement,
  type: PointerControlType,
  target: EventTarget | null,
): Target | null {
  if (!(target instanceof Element) || !root.contains(target)) return null;
  if (type === "button") {
    const button = target.closest("button");
    return button && root.contains(button) && !button.disabled
      ? {
          control: button,
          box: button,
          part: "control",
          label: null,
          optionIndex: null,
        }
      : null;
  }
  const selector =
    type === "radio" || type === "checkbox"
      ? `input[type="${type}"]`
      : "textarea,input:not([type=radio]):not([type=checkbox])";
  const direct = target.closest<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  );
  const label = target.closest("label");
  const associated = label?.control;
  const decoration =
    type === "numeric"
      ? target.closest<HTMLElement>("[data-pointer-field]")
      : null;
  const control =
    direct ??
    (associated?.matches(selector)
      ? (associated as HTMLInputElement | HTMLTextAreaElement)
      : null) ??
    decoration?.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!control || !root.contains(control) || control.disabled) return null;
  if (type === "radio" || type === "checkbox") {
    const row = control.closest("label");
    return {
      control,
      box: row ?? control,
      part: direct ? "control" : "label",
      label: !direct ? row : null,
      optionIndex: Array.from(root.querySelectorAll(selector)).indexOf(control),
    };
  }
  const fieldLabel = !direct && label && associated === control ? label : null;
  return {
    control,
    box: fieldLabel ?? (!direct && decoration ? decoration : control),
    part: fieldLabel ? "label" : !direct && decoration ? "padding" : "control",
    label: fieldLabel,
    optionIndex: null,
  };
}

interface PointerEvidence {
  target: Target;
  timestamp: number;
  pointerId: number;
  pointerType: TelemetryPointerType;
  x: number;
  y: number;
  downPosition: PointerPosition | null;
  downControlPosition: PointerPosition | null;
  isTrusted: boolean;
  fieldState: PointerFieldState | null;
  release: {
    timestamp: number;
    x: number;
    y: number;
    isTrusted: boolean;
  } | null;
  clicked: boolean;
  focused: boolean;
}

/** Observes native capture events before React's existing answer handlers run. */
export function usePointerTelemetry(
  rootRef: RefObject<HTMLElement | null>,
  {
    controlType,
    onSnapshot,
  }: {
    controlType: PointerControlType;
    onSnapshot?: (stats: PointerStats) => void;
  },
) {
  const statsRef = useRef<PointerStats>(emptyStats(controlType));
  const callbackRef = useRef(onSnapshot);
  callbackRef.current = onSnapshot;
  const enabled = Boolean(onSnapshot);
  const takeSnapshot = () => snapshot(statsRef.current);

  useLayoutEffect(() => {
    if (statsRef.current.controlType !== controlType)
      statsRef.current = emptyStats(controlType);
    const root = rootRef.current;
    if (!root || !enabled) return;
    const stats = statsRef.current;
    const doc = root.ownerDocument;
    const isField = controlType === "text" || controlType === "numeric";
    let pointer: PointerEvidence | null = null;
    let keyboard: { timestamp: number; key: string; local: boolean } | null =
      null;
    let forwarded: {
      control: Element;
      timestamp: number;
      origin: MouseEvent;
    } | null = null;
    const emit = () => callbackRef.current?.(snapshot(stats));
    const freshPointer = (control: Element) =>
      pointer &&
      pointer.target.control === control &&
      Date.now() - pointer.timestamp <= POINTER_MAX_AGE_MS
        ? pointer
        : null;
    const freshKeyboard = () =>
      keyboard && Date.now() - keyboard.timestamp <= KEY_MAX_AGE_MS
        ? keyboard
        : null;
    const fieldState = (
      control: Target["control"],
    ): PointerFieldState | null =>
      isField && "value" in control
        ? {
            wasFocused: doc.activeElement === control,
            wasEmpty: control.value.length === 0,
            priorFocusCount: stats.focusCount,
          }
        : null;

    // These document listeners keep only short-lived provenance. No text,
    // trajectory, keyboard log, or document-wide position history is retained.
    const documentPointerDown = () => {
      pointer = null;
      keyboard = null;
      forwarded = null;
    };
    const keydown = (event: KeyboardEvent) => {
      pointer = null;
      forwarded = null;
      const relevant = [
        "Tab",
        "Enter",
        " ",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(event.key);
      keyboard = relevant
        ? {
            timestamp: Date.now(),
            key: event.key,
            local: event.target instanceof Node && root.contains(event.target),
          }
        : null;
    };
    const down = (event: PointerEvent) => {
      const target = resolveTarget(root, controlType, event.target);
      if (!target || event.button !== 0) return;
      const kind = event.pointerType;
      // Only focus samples use press-time geometry. Click samples measure at
      // click time, so buttons/choices and capped focus arrays need no reads.
      const sampleFocus = isField && stats.focusSamples.length < SAMPLE_LIMIT;
      const sampleClick = stats.clickSamples.length < SAMPLE_LIMIT;
      pointer = {
        target,
        timestamp: Date.now(),
        pointerId: event.pointerId,
        pointerType:
          kind === "mouse" || kind === "touch" || kind === "pen"
            ? kind
            : "unknown",
        x: event.clientX,
        y: event.clientY,
        downPosition: sampleFocus
          ? pointerPosition(target.box, event.clientX, event.clientY)
          : null,
        downControlPosition:
          sampleFocus && target.box !== target.control
            ? pointerPosition(target.control, event.clientX, event.clientY)
            : null,
        isTrusted: event.isTrusted,
        fieldState:
          sampleFocus || sampleClick ? fieldState(target.control) : null,
        release: null,
        clicked: false,
        focused: false,
      };
    };
    const cancel = () => {
      pointer = null;
      forwarded = null;
    };
    const up = (event: PointerEvent) => {
      if (
        pointer &&
        (event.pointerId !== pointer.pointerId ||
          resolveTarget(root, controlType, event.target)?.control !==
            pointer.target.control)
      )
        cancel();
      else if (pointer)
        pointer.release = {
          timestamp: Date.now(),
          x: event.clientX,
          y: event.clientY,
          isTrusted: event.isTrusted,
        };
    };
    const makeSample = (
      event: Event,
      target: Target,
      source: PointerSource,
      evidence: PointerEvidence | null,
      coordinateEvent: "click" | "pointerdown",
    ): PointerClickSample => {
      const hasPosition = source === "pointer" && evidence !== null;
      const x =
        coordinateEvent === "click"
          ? (event as MouseEvent).clientX
          : (evidence?.x ?? 0);
      const y =
        coordinateEvent === "click"
          ? (event as MouseEvent).clientY
          : (evidence?.y ?? 0);
      const part =
        hasPosition && (controlType === "radio" || controlType === "checkbox")
          ? pointerRegion(target.box, target.control, x, y)
          : target.part;
      return {
        timestamp: Date.now(),
        source,
        pointerType: hasPosition ? evidence.pointerType : null,
        targetPart: part,
        optionIndex: target.optionIndex,
        position: hasPosition
          ? coordinateEvent === "pointerdown"
            ? evidence.downPosition && { ...evidence.downPosition }
            : pointerPosition(target.box, x, y)
          : null,
        controlPosition:
          hasPosition && target.box !== target.control
            ? coordinateEvent === "pointerdown"
              ? evidence.downControlPosition && {
                  ...evidence.downControlPosition,
                }
              : pointerPosition(target.control, x, y)
            : null,
        fieldState: evidence?.fieldState ? { ...evidence.fieldState } : null,
        coordinateEvent: hasPosition ? coordinateEvent : null,
        isTrusted: event.isTrusted,
      };
    };
    const click = (event: MouseEvent) => {
      const target = resolveTarget(root, controlType, event.target);
      if (!target) return;
      // Firefox forwards a label's pointer-like click; Chromium/WebKit use a
      // detail-zero click. Association, not detail or coordinates, deduplicates.
      if (
        forwarded &&
        !forwarded.origin.defaultPrevented &&
        event.target === forwarded.control &&
        Date.now() - forwarded.timestamp <= KEY_MAX_AGE_MS
      ) {
        forwarded = null;
        return;
      }
      forwarded = null;
      const candidate = freshPointer(target.control);
      const matchedClick =
        candidate && matchesPointerClick(candidate, event, Date.now());
      const evidence = matchedClick && !candidate.clicked ? candidate : null;
      const key = freshKeyboard();
      const keyboardClick =
        key?.local &&
        ((["button", "radio", "checkbox"].includes(controlType) &&
          (key.key === "Enter" || key.key === " ")) ||
          (controlType === "radio" && key.key.startsWith("Arrow")));
      const source: PointerSource = evidence
        ? "pointer"
        : keyboardClick
          ? "keyboard"
          : "unknown";
      if (stats.clickSamples.length < SAMPLE_LIMIT)
        stats.clickSamples.push(
          makeSample(event, target, source, evidence, "click"),
        );
      if (evidence) evidence.clicked = true;
      keyboard = null;
      if (target.label && event.target !== target.control)
        forwarded = {
          control: target.control,
          timestamp: Date.now(),
          origin: event,
        };
      stats.clickCount += 1;
      stats.clickCountsBySource[source] += 1;
      if (evidence) stats.clickCountsByPointerType[evidence.pointerType] += 1;
      emit();
    };
    const focus = (event: FocusEvent) => {
      if (!isField) return;
      const target = resolveTarget(root, controlType, event.target);
      if (!target || event.target !== target.control) return;
      const candidate = freshPointer(target.control);
      const evidence = candidate && !candidate.focused ? candidate : null;
      const key = freshKeyboard();
      const source: PointerSource = evidence
        ? "pointer"
        : key?.key === "Tab"
          ? "keyboard"
          : "unknown";
      if (stats.focusSamples.length < SAMPLE_LIMIT) {
        const sample: PointerFocusSample = {
          ...makeSample(
            event,
            evidence?.target ?? target,
            source,
            evidence,
            "pointerdown",
          ),
          fieldState: evidence?.fieldState
            ? { ...evidence.fieldState }
            : {
                wasFocused: false,
                wasEmpty: target.control.value.length === 0,
                priorFocusCount: stats.focusCount,
              },
          visit: stats.focusCount === 0 ? "first" : "return",
        };
        stats.focusSamples.push(sample);
      }
      if (evidence) evidence.focused = true;
      keyboard = null;
      stats.focusCount += 1;
      stats.focusCountsBySource[source] += 1;
      emit();
    };
    const outsideFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) {
        // A Tab can land elsewhere; it cannot explain a later programmatic focus.
        keyboard = null;
        // Label mousedown may temporarily move focus to body before forwarding.
        if (pointer?.clicked || pointer?.focused) pointer = null;
      }
    };
    const blur = (event: FocusEvent | Event) => {
      if (event.type === "blur") {
        pointer = null;
        keyboard = null;
        forwarded = null;
        return;
      }
      // Browser choice navigation can report relatedTarget=null before its
      // next focus/click. Preserve the current, unconsumed down/key evidence.
      if (pointer?.clicked || pointer?.focused) pointer = null;
    };
    doc.addEventListener("pointerdown", documentPointerDown, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", cancel, true);
    doc.addEventListener("keydown", keydown, true);
    doc.addEventListener("focusin", outsideFocus, true);
    root.addEventListener("pointerdown", down, true);
    root.addEventListener("click", click, true);
    root.addEventListener("focusin", focus, true);
    root.addEventListener("focusout", blur, true);
    doc.defaultView?.addEventListener("blur", blur);
    emit();
    return () => {
      doc.removeEventListener("pointerdown", documentPointerDown, true);
      doc.removeEventListener("pointerup", up, true);
      doc.removeEventListener("pointercancel", cancel, true);
      doc.removeEventListener("keydown", keydown, true);
      doc.removeEventListener("focusin", outsideFocus, true);
      root.removeEventListener("pointerdown", down, true);
      root.removeEventListener("click", click, true);
      root.removeEventListener("focusin", focus, true);
      root.removeEventListener("focusout", blur, true);
      doc.defaultView?.removeEventListener("blur", blur);
    };
  }, [rootRef, controlType, enabled]);

  return { snapshot: takeSnapshot };
}
