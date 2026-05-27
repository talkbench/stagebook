/**
 * Convert a character offset to a 0-based line and column.
 *
 * Uses a precomputed array of line-start offsets and binary search,
 * so each lookup is O(log lines) instead of O(offset). The line-start
 * table is memoized via a single-entry cache keyed by the source string
 * value, so repeated lookups against the same source pay the linear
 * scan only once.
 *
 * Single-entry cache is sufficient because callers typically resolve
 * many offsets against one source (semantic tokens, diagnostic ranges)
 * before moving to the next document. The cache retains a reference to
 * at most one source string at a time — processing any subsequent
 * document releases the previous one, so memory usage is bounded by the
 * largest single document rather than by the number of documents seen.
 */

let cachedSource: string | null = null;
let cachedLineStarts: number[] = [];

function computeLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function getLineStarts(source: string): number[] {
  if (cachedSource === source) return cachedLineStarts;
  cachedSource = source;
  cachedLineStarts = computeLineStarts(source);
  return cachedLineStarts;
}

export function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; col: number } {
  const lineStarts = getLineStarts(source);

  // Find the largest index i such that lineStarts[i] <= offset.
  // The newline character at position p belongs to the previous line
  // (its line-start is at p+1), so this matches the original semantics
  // where col = offset - lastNewline - 1.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, col: offset - lineStarts[lo] };
}
