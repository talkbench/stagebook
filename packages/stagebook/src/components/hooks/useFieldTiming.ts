import { useCallback, useLayoutEffect, useRef } from "react";
import type { FieldTiming } from "../../utils/promptTelemetry.js";

/** Passive, once-per-control-mount observations sampled by existing commits. */
export function useFieldTiming(getElapsedTime?: () => number) {
  const clockRef = useRef(getElapsedTime);
  clockRef.current = getElapsedTime;
  const mountedAt = useRef<number | null>(null);
  const active = useRef(true);
  const focused = useRef(false);
  const timing = useRef<FieldTiming>({
    version: 1,
    firstFocusDelayMs: null,
    firstFocusStageTimeElapsed: null,
  });

  useLayoutEffect(() => {
    active.current = true;
    // StrictMode replays effects without creating a new control lifetime.
    mountedAt.current ??= performance.now();
    return () => {
      active.current = false;
    };
  }, []);

  const onFocus = useCallback(() => {
    if (!active.current || focused.current) return;
    focused.current = true;
    // A focus before layout initialization has no measured mount origin.
    const delay =
      mountedAt.current === null ? null : performance.now() - mountedAt.current;
    let stageTime: number | undefined;
    try {
      stageTime = clockRef.current?.();
    } catch {
      // Optional telemetry must not prevent the participant using the field.
    }
    timing.current = {
      version: 1,
      firstFocusDelayMs:
        delay !== null && Number.isFinite(delay) && delay >= 0 ? delay : null,
      firstFocusStageTimeElapsed:
        stageTime !== undefined && Number.isFinite(stageTime) && stageTime >= 0
          ? stageTime
          : null,
    };
  }, []);

  const snapshot = useCallback((): FieldTiming => ({ ...timing.current }), []);
  return { onFocus, snapshot };
}
