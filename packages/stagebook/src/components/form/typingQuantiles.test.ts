import { describe, it, expect } from "vitest";
import { computeIntervalQuantiles, quantile } from "./typingQuantiles.js";

describe("quantile", () => {
  it("returns 0 for empty input", () => {
    expect(quantile([], 0.5)).toBe(0);
  });

  it("returns the sole value for a single-element array regardless of q", () => {
    expect(quantile([42], 0)).toBe(42);
    expect(quantile([42], 0.5)).toBe(42);
    expect(quantile([42], 1)).toBe(42);
  });

  it("returns min at q=0 and max at q=1", () => {
    const xs = [10, 20, 30, 40, 50];
    expect(quantile(xs, 0)).toBe(10);
    expect(quantile(xs, 1)).toBe(50);
  });

  it("linearly interpolates between adjacent samples", () => {
    // pos = 0.25 * (4) = 1.0 -> value at index 1 = 20
    const xs = [10, 20, 30, 40, 50];
    expect(quantile(xs, 0.25)).toBe(20);
    // pos = 0.5 * 4 = 2.0 -> value at index 2 = 30
    expect(quantile(xs, 0.5)).toBe(30);
    // pos = 0.125 * 4 = 0.5 -> midpoint of 10 and 20 = 15
    expect(quantile(xs, 0.125)).toBe(15);
  });
});

describe("computeIntervalQuantiles", () => {
  it("returns empty array for empty input", () => {
    expect(computeIntervalQuantiles([])).toEqual([]);
  });

  it("returns 21 identical values for a single-sample (1-interval) input", () => {
    // With 2 keystrokes there's exactly 1 interval. All quantiles of a
    // degenerate distribution equal that one sample — emitting a 21-value
    // vector keeps the schema fixed-length downstream.
    const result = computeIntervalQuantiles([42]);
    expect(result).toHaveLength(21);
    expect(result.every((v) => v === 42)).toBe(true);
  });

  it("returns 21 values for valid input", () => {
    const intervals = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = computeIntervalQuantiles(intervals);
    expect(result).toHaveLength(21);
  });

  it("returns monotonically non-decreasing values (sorted distribution)", () => {
    // Intentionally shuffled input
    const intervals = [50, 10, 30, 90, 70, 20, 80, 40, 60, 100];
    const result = computeIntervalQuantiles(intervals);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
    }
  });

  it("places the median (q=0.5, index 10) at the central value", () => {
    const intervals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const result = computeIntervalQuantiles(intervals);
    // 11 samples sorted: pos = 0.5 * 10 = 5 -> value at index 5 = 6
    expect(result[10]).toBe(6);
  });

  it("places the min at index 0 and the max at index 20", () => {
    const intervals = [50, 10, 30, 90, 70, 20, 80, 40, 60, 100];
    const result = computeIntervalQuantiles(intervals);
    expect(result[0]).toBe(10);
    expect(result[20]).toBe(100);
  });
});
