import { describe, it, expect } from "vitest";
import { runPool } from "./runPool";

/** Resolve after a microtask-ish delay without real timers. */
function tick(): Promise<void> {
  return Promise.resolve();
}

describe("runPool", () => {
  it("runs every task", async () => {
    const seen: number[] = [];
    const tasks = [1, 2, 3, 4, 5].map((n) => () => {
      seen.push(n);
      return Promise.resolve(n);
    });

    await runPool(tasks, 2);

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never exceeds the concurrency limit of in-flight tasks", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const releasers: Array<() => void> = [];

    const tasks = Array.from({ length: 6 }, () => () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<void>((resolve) => {
        releasers.push(() => {
          inFlight -= 1;
          resolve();
        });
      });
    });

    const done = runPool(tasks, 2);

    // Let the pool start its first batch.
    await tick();
    expect(maxInFlight).toBeLessThanOrEqual(2);

    // Drain: release tasks one at a time, allowing the pool to refill.
    while (releasers.length > 0) {
      const release = releasers.shift()!;
      release();
      await tick();
      await tick();
    }

    await done;
    expect(maxInFlight).toBe(2);
  });

  it("isolates failures so a rejecting task does not abort the others", async () => {
    const completed: number[] = [];
    const tasks = [0, 1, 2, 3].map((n) => () => {
      if (n === 1) return Promise.reject(new Error("boom"));
      completed.push(n);
      return Promise.resolve();
    });

    // Should not throw even though one task rejects.
    await expect(runPool(tasks, 2)).resolves.toBeUndefined();
    expect(completed.sort((a, b) => a - b)).toEqual([0, 2, 3]);
  });

  it("handles an empty task list", async () => {
    await expect(runPool([], 4)).resolves.toBeUndefined();
  });

  it("treats a concurrency limit below 1 as 1", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 3 }, () => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight -= 1;
    });

    await runPool(tasks, 0);
    expect(maxInFlight).toBe(1);
  });
});
