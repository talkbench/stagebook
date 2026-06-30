/**
 * Run `tasks` with at most `limit` in flight at once, waiting for all to
 * settle. Each task is a thunk returning a promise.
 *
 * Failure isolation: a task that rejects does NOT abort the pool or the
 * returned promise — its rejection is swallowed so the remaining tasks still
 * run to completion. Callers that need per-task outcomes should capture them
 * inside the thunk (e.g. set diagnostics as a side effect) rather than relying
 * on a return value.
 *
 * This bound matters in the extension host: validating a treatment file is
 * several seconds of synchronous Zod recursion, so firing every workspace file
 * at once would jank the UI. A small pool keeps the host responsive while still
 * overlapping the async import reads.
 */
export async function runPool(
  tasks: Array<() => Promise<unknown>>,
  limit: number,
): Promise<void> {
  const max = Math.max(1, Math.floor(limit));
  let next = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      try {
        await tasks[index]();
      } catch {
        // Failure isolation — see doc comment. The task itself is responsible
        // for surfacing its own errors.
      }
    }
  }

  const workerCount = Math.min(max, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
