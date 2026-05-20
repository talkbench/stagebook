import { describe, expect, test } from "vitest";
import { computeSafeRel } from "./Markdown.js";

// External-link `rel` contract: markdown links that open in a new
// tab (target="_blank") must receive `rel="noopener noreferrer"`
// so the new tab can't reach back to `window.opener` (tab-nabbing)
// and the destination doesn't receive a Referer header. The handler
// is invoked from inside react-markdown's `components.a`, where the
// only way to introduce `target="_blank"` without raw HTML is via
// rehype-raw — too much plumbing for one contract assertion. The
// helper is exported so the contract is unit-testable on its own.

describe("computeSafeRel", () => {
  test("no target → rel passes through unchanged (no rewrite)", () => {
    expect(computeSafeRel(undefined, undefined)).toBeUndefined();
    expect(computeSafeRel(undefined, "author")).toBe("author");
  });

  test("target=_self → rel passes through unchanged", () => {
    expect(computeSafeRel("_self", "author")).toBe("author");
  });

  test("target=_blank + no source rel → adds 'noopener noreferrer'", () => {
    expect(computeSafeRel("_blank", undefined)).toBe("noopener noreferrer");
  });

  test("target=_blank + existing rel → appends noopener noreferrer to the source", () => {
    // Researcher-provided `rel="author"` is preserved.
    expect(computeSafeRel("_blank", "author")).toBe(
      "author noopener noreferrer",
    );
  });

  test("target=_blank with already-present noopener → still safe (no harm in duplicate tokens)", () => {
    // Browsers tokenize `rel`, so duplicate `noopener` is a no-op.
    // The helper doesn't dedupe — duplicates aren't a bug, just
    // verbose. This test locks in the simple-concat behavior.
    const out = computeSafeRel("_blank", "noopener");
    expect(out).toContain("noopener");
    expect(out).toContain("noreferrer");
  });
});
