import { useCallback, useEffect, useMemo, useRef } from "react";

export interface ResponseCommitOptions<T> {
  onCommit?: (value: T) => void;
  /** Quiet period after the latest local edit. */
  debounceDelay?: number;
  /** Maximum age of a batch, measured from its first local edit. */
  maxWait?: number;
}

/**
 * Response commit timing shared by solo fields and host-rendered shared fields.
 * Pending state is synchronous, so a remote merge or blur in the same event
 * reaches the next commit without waiting for React to render.
 */
export function useResponseCommit<T>({
  onCommit,
  debounceDelay = 2000,
  maxWait = 5000,
}: ResponseCommitOptions<T>) {
  // A box distinguishes a queued `undefined` from no queued response.
  const pending = useRef<{ value: T } | undefined>(undefined);
  const quietTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const maximumTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const active = useRef(true);

  const cancel = useCallback(() => {
    if (quietTimer.current !== undefined) clearTimeout(quietTimer.current);
    if (maximumTimer.current !== undefined) clearTimeout(maximumTimer.current);
    quietTimer.current = undefined;
    maximumTimer.current = undefined;
    pending.current = undefined;
  }, []);

  const flush = useCallback(() => {
    const response = pending.current;
    // Clear first: an onCommit callback may start a new batch synchronously.
    cancel();
    if (active.current && response !== undefined) {
      onCommitRef.current?.(response.value);
    }
  }, [cancel]);

  const queue = useCallback(
    (value: T) => {
      if (!active.current) return;
      pending.current = { value };
      if (quietTimer.current !== undefined) clearTimeout(quietTimer.current);
      quietTimer.current = setTimeout(flush, debounceDelay);
      // Later local edits move only the quiet deadline, never the maximum.
      if (maximumTimer.current === undefined) {
        maximumTimer.current = setTimeout(flush, maxWait);
      }
    },
    [debounceDelay, maxWait, flush],
  );

  const replacePending = useCallback((value: T) => {
    if (active.current && pending.current !== undefined) {
      pending.current = { value };
    }
  }, []);

  // Solo fields commit even unchanged text on blur/drop to carry telemetry.
  // Shared fields instead call flush(), which is a no-op when idle.
  const commit = useCallback(
    (value: T) => {
      cancel();
      if (active.current) onCommitRef.current?.(value);
    },
    [cancel],
  );
  const hasPending = useCallback(() => pending.current !== undefined, []);
  const peek = useCallback(() => pending.current?.value, []);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cancel();
    };
  }, [cancel]);

  return useMemo(
    () => ({ queue, replacePending, flush, cancel, commit, hasPending, peek }),
    [queue, replacePending, flush, cancel, commit, hasPending, peek],
  );
}
