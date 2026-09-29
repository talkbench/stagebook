import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSeekCoalescer, type CoalescedSeek } from "./seekCoalescer.js";

describe("createSeekCoalescer (#682)", () => {
  let logged: CoalescedSeek[];
  let seeks: ReturnType<typeof createSeekCoalescer>;

  beforeEach(() => {
    vi.useFakeTimers();
    logged = [];
    seeks = createSeekCoalescer((seek) => logged.push(seek), 500);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs one seek once the stream settles", () => {
    seeks.seek(4, 5, 10);
    seeks.seek(5, 6, 10.1);
    seeks.seek(6, 8, 10.2);
    vi.advanceTimersByTime(499);
    expect(logged).toEqual([]);
    vi.advanceTimersByTime(1);
    // From where the stream started, to where it landed, stamped when it began.
    expect(logged).toEqual([
      { fromTime: 4, videoTime: 8, stageTimeElapsed: 10 },
    ]);
  });

  it("restarts the settle window on every seek", () => {
    seeks.seek(0, 1, 0);
    vi.advanceTimersByTime(400);
    seeks.seek(1, 2, 0.4);
    vi.advanceTimersByTime(400);
    expect(logged).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(logged).toEqual([
      { fromTime: 0, videoTime: 2, stageTimeElapsed: 0 },
    ]);
  });

  it("flush logs the pending seek immediately, once", () => {
    seeks.seek(3, 7, 1);
    seeks.flush();
    expect(logged).toEqual([
      { fromTime: 3, videoTime: 7, stageTimeElapsed: 1 },
    ]);
    vi.advanceTimersByTime(1000);
    seeks.flush();
    expect(logged).toHaveLength(1);
  });

  it("flush with nothing pending logs nothing", () => {
    seeks.flush();
    expect(logged).toEqual([]);
  });

  it("starts a new stream after a flush", () => {
    seeks.seek(0, 5, 0);
    seeks.flush();
    seeks.seek(5, 9, 2);
    vi.advanceTimersByTime(500);
    expect(logged).toEqual([
      { fromTime: 0, videoTime: 5, stageTimeElapsed: 0 },
      { fromTime: 5, videoTime: 9, stageTimeElapsed: 2 },
    ]);
  });

  it("drops a stream that returns to where it started", () => {
    seeks.seek(4, 6, 0);
    seeks.seek(6, 4, 0);
    vi.advanceTimersByTime(500);
    expect(logged).toEqual([]);
  });
});
