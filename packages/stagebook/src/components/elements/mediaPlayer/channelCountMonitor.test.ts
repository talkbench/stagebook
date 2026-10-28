import { afterEach, expect, test, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  CHANNEL_COUNT_WORKLET,
  monitorChannelCount,
} from "./channelCountMonitor.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("raw count guard ignores pre-play silence and reports changing discrete widths", () => {
  const reports: number[] = [];
  let Processor!: new () => { process(inputs: Float32Array[][]): boolean };
  runInNewContext(CHANNEL_COUNT_WORKLET, {
    AudioWorkletProcessor: class {
      port = { postMessage: (n: number) => reports.push(n) };
    },
    registerProcessor: (_name: string, processor: typeof Processor) => {
      Processor = processor;
    },
  });
  const processor = new Processor();
  const block = (count: number, amplitude: number) => [
    Array.from({ length: count }, () => new Float32Array(128).fill(amplitude)),
  ];
  processor.process([[]]);
  processor.process(block(1, 0));
  processor.process(block(3, 0.1));
  processor.process(block(3, 0.1));
  processor.process(block(2, 0));
  processor.process(block(2, 0.1));
  expect(reports).toEqual([3, 2]);
});

test.each(["abort", "timeout"])(
  "a stalled module releases its blob on %s",
  async (mode) => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const controller = new AbortController();
    const ctx = {
      audioWorklet: { addModule: () => new Promise<void>(() => {}) },
    } as unknown as AudioContext;
    const pending = monitorChannelCount(
      ctx,
      {} as AudioNode,
      () => {},
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow(
      mode === "abort" ? "cancelled" : "timed out",
    );
    if (mode === "abort") controller.abort();
    else await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);
