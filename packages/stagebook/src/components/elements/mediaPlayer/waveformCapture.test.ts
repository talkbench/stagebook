import { describe, it, expect } from "vitest";
import {
  computeBucketCount,
  timeToBucket,
  accumulatePeaks,
  createPeaksArrays,
  allBuffersSilent,
  peaksFromSamples,
  MAX_BUCKETS,
} from "./waveformCapture.js";

describe("computeBucketCount", () => {
  it("returns correct count for a 60s clip at 10 buckets/sec", () => {
    expect(computeBucketCount(60, 10)).toBe(600);
  });

  it("rounds up for fractional durations", () => {
    expect(computeBucketCount(5.3, 10)).toBe(53);
  });

  it("returns 0 for zero duration", () => {
    expect(computeBucketCount(0, 10)).toBe(0);
  });

  it("returns 0 for negative duration", () => {
    expect(computeBucketCount(-1, 10)).toBe(0);
  });

  it("handles non-finite duration", () => {
    expect(computeBucketCount(Infinity, 10)).toBe(0);
    expect(computeBucketCount(NaN, 10)).toBe(0);
  });

  it("caps at MAX_BUCKETS to prevent unbounded memory allocation", () => {
    // 1 million seconds × 10 bps = 10M, way over MAX_BUCKETS (1M)
    expect(computeBucketCount(1_000_000, 10)).toBe(MAX_BUCKETS);
  });

  it("does not cap when below MAX_BUCKETS", () => {
    // Just under the cap
    expect(computeBucketCount(99_999, 10)).toBe(999_990);
  });
});

describe("timeToBucket", () => {
  it("maps time 0 to bucket 0", () => {
    expect(timeToBucket(0, 10)).toBe(0);
  });

  it("maps 1.5s to bucket 15 at 10 buckets/sec", () => {
    expect(timeToBucket(1.5, 10)).toBe(15);
  });

  it("floors fractional buckets", () => {
    expect(timeToBucket(0.15, 10)).toBe(1);
  });

  it("clamps negative time to 0", () => {
    expect(timeToBucket(-1, 10)).toBe(0);
  });
});

describe("createPeaksArrays", () => {
  it("creates one Float32Array per channel", () => {
    const peaks = createPeaksArrays(2, 100);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeInstanceOf(Float32Array);
    expect(peaks[1]).toBeInstanceOf(Float32Array);
  });

  it("each array has 2 * bucketCount elements (min/max interleaved)", () => {
    const peaks = createPeaksArrays(1, 50);
    expect(peaks[0].length).toBe(100);
  });

  it("initializes min values to 1 and max values to -1 (no data sentinel)", () => {
    const peaks = createPeaksArrays(1, 2);
    // bucket 0: min at [0], max at [1]
    // bucket 1: min at [2], max at [3]
    expect(peaks[0][0]).toBe(1); // min sentinel
    expect(peaks[0][1]).toBe(-1); // max sentinel
    expect(peaks[0][2]).toBe(1);
    expect(peaks[0][3]).toBe(-1);
  });

  it("returns empty array for 0 channels", () => {
    expect(createPeaksArrays(0, 100)).toEqual([]);
  });
});

describe("accumulatePeaks", () => {
  it("updates min/max for the correct bucket", () => {
    const peaks = createPeaksArrays(1, 10);
    // Simulate analyser data: Uint8Array centered at 128 (silence)
    // Values > 128 are positive amplitude, < 128 are negative
    const analyserData = new Uint8Array(256);
    // Fill with a signal: some high, some low
    analyserData[0] = 200; // maps to +0.5625
    analyserData[1] = 50; // maps to -0.609375

    accumulatePeaks(peaks, [analyserData], 0.05, 10);
    // bucket 0 at time 0.05 = bucket 0
    // min should be updated from sentinel 1 to the lowest sample
    // max should be updated from sentinel -1 to the highest sample
    const minVal = peaks[0][0];
    const maxVal = peaks[0][1];
    expect(minVal).toBeLessThan(0); // negative amplitude present
    expect(maxVal).toBeGreaterThan(0); // positive amplitude present
  });

  it("preserves existing data in other buckets", () => {
    const peaks = createPeaksArrays(1, 10);
    const analyserData = new Uint8Array(256);
    analyserData.fill(128); // silence
    analyserData[0] = 200;

    accumulatePeaks(peaks, [analyserData], 0.05, 10); // bucket 0
    // bucket 1 should still have sentinel values
    expect(peaks[0][2]).toBe(1); // min sentinel
    expect(peaks[0][3]).toBe(-1); // max sentinel
  });

  it("accumulates across multiple calls to the same bucket", () => {
    const peaks = createPeaksArrays(1, 10);

    // First call: moderate signal
    const data1 = new Uint8Array(256);
    data1.fill(128);
    data1[0] = 180; // moderate positive

    accumulatePeaks(peaks, [data1], 0.05, 10);
    const maxAfterFirst = peaks[0][1];

    // Second call: stronger signal in same bucket
    const data2 = new Uint8Array(256);
    data2.fill(128);
    data2[0] = 240; // stronger positive

    accumulatePeaks(peaks, [data2], 0.08, 10);
    const maxAfterSecond = peaks[0][1];

    expect(maxAfterSecond).toBeGreaterThan(maxAfterFirst);
  });

  it("handles multiple channels independently", () => {
    const peaks = createPeaksArrays(2, 10);

    const ch0Data = new Uint8Array(256);
    ch0Data.fill(128);
    ch0Data[0] = 200; // strong signal

    const ch1Data = new Uint8Array(256);
    ch1Data.fill(128); // silence

    accumulatePeaks(peaks, [ch0Data, ch1Data], 0.05, 10);

    // Channel 0 should have signal
    expect(peaks[0][1]).toBeGreaterThan(0);
    // Channel 1 should still be at or near zero (silence)
    // With all-128 data, both min and max normalize to 0
    expect(peaks[1][1]).toBeCloseTo(0, 1);
  });
});

describe("allBuffersSilent", () => {
  it("returns true when all buffers contain only the silence midpoint (128)", () => {
    // getByteTimeDomainData uses 128 as the zero-amplitude midpoint.
    // CORS-tainted AnalyserNodes return constant 128 (true silence).
    const buf1 = new Uint8Array(256);
    const buf2 = new Uint8Array(256);
    buf1.fill(128);
    buf2.fill(128);
    expect(allBuffersSilent([buf1, buf2])).toBe(true);
  });

  it("returns false when any buffer contains a non-silence sample", () => {
    const buf1 = new Uint8Array(256);
    const buf2 = new Uint8Array(256);
    buf1.fill(128);
    buf2.fill(128);
    buf2[0] = 200; // signal in channel 1
    expect(allBuffersSilent([buf1, buf2])).toBe(false);
  });

  it("returns false for an empty buffer list", () => {
    // Empty input is ambiguous, but the detector should not warn when
    // there are no buffers to check yet. Returning false defers warning.
    expect(allBuffersSilent([])).toBe(false);
  });

  it("handles a single buffer", () => {
    const buf = new Uint8Array(256);
    buf.fill(128);
    expect(allBuffersSilent([buf])).toBe(true);
  });

  it("a single non-128 sample is enough to count as non-silent", () => {
    const buf = new Uint8Array(256);
    buf.fill(128);
    buf[42] = 129;
    expect(allBuffersSilent([buf])).toBe(false);
  });
});

describe("peaksFromSamples", () => {
  it("folds each bucket's samples into an interleaved min/max pair", () => {
    // 10 samples → 2 buckets of 5.
    const channel = Float32Array.from([
      0.1, -0.2, 0.3, -0.4, 0.5, 0.05, -0.9, 0.7, 0.0, 0.1,
    ]);
    const peaks = peaksFromSamples([channel], 2);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(-0.4);
    expect(peaks[1]).toBeCloseTo(0.5);
    expect(peaks[2]).toBeCloseTo(-0.9);
    expect(peaks[3]).toBeCloseTo(0.7);
  });

  it("gives the last bucket the remainder when samples do not divide evenly", () => {
    // 7 samples → 3 buckets: [0,1], [2,3], [4,5,6].
    const channel = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.95]);
    const peaks = peaksFromSamples([channel], 3);
    expect(peaks[4]).toBeCloseTo(0.5);
    expect(peaks[5]).toBeCloseTo(0.95);
  });

  it("merges every channel into one envelope", () => {
    const left = Float32Array.from([0.1, 0.1, 0.1, 0.1]);
    const right = Float32Array.from([-0.6, 0.0, 0.0, 0.8]);
    const peaks = peaksFromSamples([left, right], 1);
    expect(peaks[0]).toBeCloseTo(-0.6);
    expect(peaks[1]).toBeCloseTo(0.8);
  });

  it("clamps decoded samples that overshoot full scale", () => {
    const channel = Float32Array.from([1.7, -1.3]);
    const peaks = peaksFromSamples([channel], 1);
    expect(peaks[0]).toBe(-1);
    expect(peaks[1]).toBe(1);
  });

  it("leaves buckets with no samples at the empty sentinel", () => {
    // 2 samples spread over 4 buckets: only buckets 0 and 2 receive data.
    const channel = Float32Array.from([0.5, -0.5]);
    const peaks = peaksFromSamples([channel], 4);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(0.5);
    expect(peaks[2]).toBe(1);
    expect(peaks[3]).toBe(-1);
  });

  it("returns an all-sentinel array for empty channel data", () => {
    const peaks = peaksFromSamples([new Float32Array(0)], 3);
    expect(Array.from(peaks)).toEqual([1, -1, 1, -1, 1, -1]);
    expect(Array.from(peaksFromSamples([], 2))).toEqual([1, -1, 1, -1]);
  });

  it("returns an empty array for a non-positive bucket count", () => {
    const channel = Float32Array.from([0.5]);
    expect(peaksFromSamples([channel], 0)).toHaveLength(0);
    expect(peaksFromSamples([channel], -3)).toHaveLength(0);
    expect(peaksFromSamples([channel], NaN)).toHaveLength(0);
  });

  it("caps the bucket count at MAX_BUCKETS", () => {
    const channel = Float32Array.from([0.5, 0.5]);
    expect(peaksFromSamples([channel], MAX_BUCKETS + 10)).toHaveLength(
      MAX_BUCKETS * 2,
    );
  });
});
