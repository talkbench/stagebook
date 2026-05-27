import { describe, it, expect } from "vitest";
import { offsetToLineCol } from "./offsetToLineCol.js";

/**
 * Reference implementation: linear scan from the start of the source.
 * Used to verify the optimized version returns identical results.
 */
function offsetToLineColLinear(
  source: string,
  offset: number,
): { line: number; col: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: offset - lastNewline - 1 };
}

describe("offsetToLineCol", () => {
  it("returns line 0 col 0 for offset 0", () => {
    expect(offsetToLineCol("hello\nworld", 0)).toEqual({ line: 0, col: 0 });
  });

  it("returns column within the first line", () => {
    expect(offsetToLineCol("hello\nworld", 3)).toEqual({ line: 0, col: 3 });
  });

  it("returns line 1 col 0 right after a newline", () => {
    // "hello\n" length 6 — offset 6 is start of next line
    expect(offsetToLineCol("hello\nworld", 6)).toEqual({ line: 1, col: 0 });
  });

  it("returns column on a later line", () => {
    expect(offsetToLineCol("hello\nworld", 9)).toEqual({ line: 1, col: 3 });
  });

  it("treats the newline character itself as belonging to the previous line", () => {
    // offset 5 points to the '\n' at the end of "hello"
    expect(offsetToLineCol("hello\nworld", 5)).toEqual({ line: 0, col: 5 });
  });

  it("handles empty source", () => {
    expect(offsetToLineCol("", 0)).toEqual({ line: 0, col: 0 });
  });

  it("handles source with no newlines", () => {
    expect(offsetToLineCol("abcdef", 4)).toEqual({ line: 0, col: 4 });
  });

  it("handles consecutive newlines (blank lines)", () => {
    // "a\n\n\nb" — offsets: 0=a 1=\n 2=\n 3=\n 4=b
    expect(offsetToLineCol("a\n\n\nb", 4)).toEqual({ line: 3, col: 0 });
  });

  it("matches the linear reference impl across all offsets in a multi-line source", () => {
    const src = `line1
line2 with more content
\nline4
final line\n`;
    for (let offset = 0; offset <= src.length + 5; offset++) {
      expect(offsetToLineCol(src, offset)).toEqual(
        offsetToLineColLinear(src, offset),
      );
    }
  });

  it("matches the linear reference impl on a large generated source", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push(`line ${i} with some filler content`);
    }
    const src = lines.join("\n");

    // Sample many offsets across the source
    for (let offset = 0; offset <= src.length; offset += 17) {
      expect(offsetToLineCol(src, offset)).toEqual(
        offsetToLineColLinear(src, offset),
      );
    }
  });

  it("is fast on a large source with many offset lookups", () => {
    // Build a ~200 KB source with ~5000 lines
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(`line ${i}: ${"x".repeat(40)}`);
    }
    const src = lines.join("\n");

    // Convert ~10000 offsets distributed across the source.
    // The naive O(offset) impl would take seconds on this input; the
    // binary-search impl finishes in a few milliseconds on a dev machine.
    // The bound here is generous (2s) to avoid flaking on slow/loaded CI
    // runners while still failing loudly if the implementation regresses
    // to the quadratic behaviour this module was written to fix.
    const start = performance.now();
    let acc = 0;
    for (let i = 0; i < 10000; i++) {
      const offset = (i * 17) % src.length;
      const { line, col } = offsetToLineCol(src, offset);
      acc += line + col;
    }
    const elapsed = performance.now() - start;

    expect(acc).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  });

  it("works correctly when called with different sources interleaved", () => {
    // Verifies the cache invalidates when source changes
    const a = "aaa\nbbb\nccc";
    const b = "x\ny\nz";
    expect(offsetToLineCol(a, 8)).toEqual({ line: 2, col: 0 });
    expect(offsetToLineCol(b, 4)).toEqual({ line: 2, col: 0 });
    expect(offsetToLineCol(a, 4)).toEqual({ line: 1, col: 0 });
    expect(offsetToLineCol(b, 2)).toEqual({ line: 1, col: 0 });
  });
});
