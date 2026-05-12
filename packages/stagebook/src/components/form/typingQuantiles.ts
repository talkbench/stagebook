// Linear interpolation between sorted samples at the requested quantile in
// [0, 1]. Empty arrays return 0; callers gate on length first.
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// 21 quantiles at 0%, 5%, 10%, ..., 95%, 100% of the input distribution.
// Returns 21 values for any non-empty input — a single-sample distribution
// is degenerate but well-defined (all quantiles equal that sample). Returns
// an empty array only for empty input; callers gate on emptiness and emit
// `null` in that case.
export function computeIntervalQuantiles(intervals: number[]): number[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a - b);
  const result: number[] = [];
  for (let i = 0; i <= 20; i++) {
    result.push(quantile(sorted, i / 20));
  }
  return result;
}
