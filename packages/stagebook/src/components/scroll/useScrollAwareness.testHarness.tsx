import { useEffect, useRef, useState } from "react";
import { useScrollAwareness } from "./useScrollAwareness.js";

/**
 * Drives `useScrollAwareness` from a fixed-height scroll container with
 * three buttons for the three growth states the test cares about. The
 * hook's `showIndicator` is mirrored into a `data-testid="indicator-state"`
 * element, and the container's post-render `scrollHeight` into a
 * `data-testid="scroll-height"` element so tests can wait on a
 * deterministic signal that the MutationObserver+rAF tick has landed
 * before the next click.
 *
 * Sizing note: with `height: 200px; overflow: auto`, the container's
 * `scrollHeight` is `max(clientHeight, contentHeight)`. So `scrollHeight`
 * stays at 200 until content exceeds 200, after which it grows with
 * content. The "fits" lines therefore all read 200; only the overflow
 * lines produce observable growth events.
 */
export function Harness({ containerHeight }: { containerHeight: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { showIndicator } = useScrollAwareness(containerRef);
  // Discrete content sizes the tests step through. `fits` is the
  // pre-overflow baseline; `overflow1` trips the hook's first-growth
  // initialization gate; `overflow2` is the actual growth that should
  // surface the indicator.
  const [contentLines, setContentLines] = useState(2);
  const [scrollHeight, setScrollHeight] = useState(0);

  const lineHeight = 24;

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (containerRef.current) {
        setScrollHeight(containerRef.current.scrollHeight);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [contentLines]);

  return (
    <div>
      <div data-testid="indicator-state">
        {showIndicator ? "visible" : "hidden"}
      </div>
      <div data-testid="scroll-height">{scrollHeight}</div>
      <button
        type="button"
        data-testid="overflow-1"
        onClick={() => {
          setContentLines(30);
        }}
      >
        Overflow (warmup)
      </button>
      <button
        type="button"
        data-testid="overflow-2"
        onClick={() => {
          setContentLines(60);
        }}
      >
        Overflow more
      </button>
      <button
        type="button"
        data-testid="shrink-fits"
        onClick={() => {
          setContentLines(2);
        }}
      >
        Shrink (fits)
      </button>
      <div
        ref={containerRef}
        data-testid="scroll-container"
        style={{
          height: `${String(containerHeight)}px`,
          overflow: "auto",
          border: "1px solid #ccc",
        }}
      >
        {Array.from({ length: contentLines }).map((_, i) => (
          <div key={i} style={{ height: `${String(lineHeight)}px` }}>
            line {i + 1}
          </div>
        ))}
      </div>
    </div>
  );
}
