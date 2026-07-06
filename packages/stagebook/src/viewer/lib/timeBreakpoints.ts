/**
 * Extract sorted, unique time breakpoints from a stage's elements.
 * These are the moments where the visible content changes due to
 * displayTime or hideTime thresholds.
 */
export function extractTimeBreakpoints(
  elements: Record<string, unknown>[],
): number[] {
  const times = new Set<number>();

  for (const element of elements) {
    if (typeof element.displayTime === "number" && element.displayTime > 0) {
      times.add(element.displayTime);
    }
    if (typeof element.hideTime === "number" && element.hideTime > 0) {
      times.add(element.hideTime);
    }
  }

  return [...times].sort((a, b) => a - b);
}
