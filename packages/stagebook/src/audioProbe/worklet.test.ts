import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ProbeReport } from "./analyze.js";
import { BURST_GAP_SECONDS } from "./analyze.js";
import { PROCESSOR_NAME, WORKLET_SOURCE } from "./worklet.js";

// Runs the worklet source against a minimal stand-in for
// AudioWorkletGlobalScope. Real-browser behaviour is covered by
// audioProbe.ct.tsx; this pins the bookkeeping deterministically.

interface Port {
  onmessage: ((event: unknown) => void) | null;
  postMessage: (data: unknown) => void;
}

interface Processor {
  port: Port;
  process: (inputs: Float32Array[][]) => boolean;
}

type ProcessorClass = new (options: {
  processorOptions: { channels: number };
}) => Processor;

const scope = globalThis as unknown as {
  sampleRate?: number;
  currentFrame?: number;
};

let registered: { name: string; ctor: ProcessorClass } | null = null;

function load(): ProcessorClass {
  class FakeProcessor {
    port: Port = { onmessage: null, postMessage: () => undefined };
  }
  const register = (name: string, ctor: ProcessorClass) => {
    registered = { name, ctor };
  };
  // The worklet reads `sampleRate` and `currentFrame` as globals, as it does
  // in AudioWorkletGlobalScope. Evaluating the shipped source text is the
  // point: it is what the browser runs.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    WORKLET_SOURCE,
  ) as (processor: unknown, registerProcessor: unknown) => void;
  run(FakeProcessor, register);
  if (!registered) throw new Error("worklet did not register a processor");
  return registered.ctor;
}

function create(channels: number) {
  const Ctor = load();
  const node = new Ctor({ processorOptions: { channels } });
  let reply: ProbeReport | null = null;
  node.port.postMessage = (data) => {
    reply = data as ProbeReport;
  };
  /** Feed one render quantum per call, advancing `currentFrame`. */
  const feed = (...channelSamples: number[][]) => {
    const keepAlive = node.process([
      channelSamples.map((s) => Float32Array.from(s)),
    ]);
    scope.currentFrame = (scope.currentFrame ?? 0) + channelSamples[0].length;
    return keepAlive;
  };
  const report = (): ProbeReport => {
    node.port.onmessage?.({ data: "report" });
    if (!reply) throw new Error("worklet did not reply");
    return reply;
  };
  return { feed, report, feedEmpty: () => node.process([[]]) };
}

beforeEach(() => {
  scope.sampleRate = 48_000;
  scope.currentFrame = 0;
  registered = null;
});

afterEach(() => {
  delete scope.sampleRate;
  delete scope.currentFrame;
});

describe("probe worklet", () => {
  test("registers under the processor name the probe constructs", () => {
    load();
    expect(registered?.name).toBe(PROCESSOR_NAME);
  });

  test("records each channel's peak and the context frame it came at", () => {
    const w = create(2);
    w.feed([0, 0.2, 0], [0, 0, 0]);
    w.feed([0, 0, 0], [0.1, 0, -0.6]);
    const r = w.report();
    expect(r.sampleRate).toBe(48_000);
    expect(r.inputChannels).toBe(2);
    expect(r.channels[0].peakFrame).toBe(1);
    expect(r.channels[0].peak).toBeCloseTo(0.2, 6);
    // Negative excursions count by magnitude; frame 3 + index 2.
    expect(r.channels[1].peakFrame).toBe(5);
    expect(r.channels[1].peak).toBeCloseTo(0.6, 6);
  });

  test("keeps the first frame of a repeated peak", () => {
    const w = create(1);
    w.feed([0.5, 0.5, 0.5]);
    expect(w.report().channels[0].peakFrame).toBe(0);
  });

  test("counts samples above the floor and spans them first to last", () => {
    const w = create(1);
    w.feed([0, 0.011, 0.005, -0.02]);
    w.feed([0.01, 0.3, 0, 0]);
    const ch = w.report().channels[0];
    // 0.01 is not above the floor; 0.011, -0.02 and 0.3 are.
    expect(ch.hotSamples).toBe(3);
    expect(ch.firstHotFrame).toBe(1);
    expect(ch.lastHotFrame).toBe(5);
  });

  test("counts bursts: a gap longer than BURST_GAP_SECONDS starts a new one", () => {
    // At 1 kHz the gap is BURST_GAP_SECONDS * 1000 frames.
    scope.sampleRate = 1_000;
    const gap = BURST_GAP_SECONDS * 1_000;
    const w = create(2);
    const quiet = (n: number) => new Array<number>(n).fill(0);
    // Channel 0: hot, a dip as long as the gap, hot again (one burst).
    // Channel 1: hot, a dip one frame longer than the gap, hot again (two).
    w.feed([0.5, ...quiet(gap - 1), 0.5], [0.5, ...quiet(gap), 0.5]);
    const [same, split] = w.report().channels;
    expect(same.bursts).toBe(1);
    expect(split.bursts).toBe(2);
  });

  test("a silent channel reports no peak and no signal", () => {
    const w = create(2);
    w.feed([0.4, 0], [0, 0]);
    expect(w.report().channels[1]).toEqual({
      peak: 0,
      peakFrame: -1,
      hotSamples: 0,
      firstHotFrame: -1,
      lastHotFrame: -1,
      bursts: 0,
    });
  });

  test("reports zero input channels when no audio ever arrived", () => {
    const w = create(3);
    w.feedEmpty();
    const r = w.report();
    expect(r.inputChannels).toBe(0);
    expect(r.channels).toHaveLength(3);
  });

  test("ignores input channels beyond the asset's count", () => {
    const w = create(1);
    w.feed([0.1], [0.9]);
    const r = w.report();
    expect(r.inputChannels).toBe(2);
    expect(r.channels).toHaveLength(1);
    expect(r.channels[0].peak).toBeCloseTo(0.1, 6);
  });

  test("keeps the processor alive between quanta", () => {
    expect(create(1).feed([0])).toBe(true);
  });
});
