// @vitest-environment jsdom
// (jsdom is a workspace-hoisted devDependency, provided by the library package.)
//
// #524: the picker banner must also offer asset:// prefixes the host-side scan
// can't see (prompt bodies, field values). useAssetBanner collects the prefixes
// getAssetURL reports unresolved at render time and unions them with the scan.
// These tests exercise the render-phase collection + reconcile loop (its
// convergence is load-bearing — a non-converging effect would hang act()).
import { describe, it, expect, beforeAll } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAssetBanner } from "./useAssetBanner.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

interface HarnessProps {
  unmapped: string[];
  assetRoots: Record<string, string>;
  contentVersion: number;
  /** Prefixes the "child tree" references this render (simulates getAssetURL). */
  refsToRender: string[];
  onBanner: (banner: string[]) => void;
  onCollector?: (collect: (prefix: string) => void) => void;
}

/** Drives the hook and simulates getAssetURL collecting during render. */
function Harness({
  unmapped,
  assetRoots,
  contentVersion,
  refsToRender,
  onBanner,
  onCollector,
}: HarnessProps) {
  const { bannerPrefixes, collectUnresolved } = useAssetBanner(
    unmapped,
    assetRoots,
    contentVersion,
  );
  // Mirror getAssetURL: report any referenced asset:// prefix that isn't mounted.
  for (const prefix of refsToRender) {
    if (!assetRoots[prefix]) collectUnresolved(prefix);
  }
  onBanner(bannerPrefixes);
  onCollector?.(collectUnresolved);
  return null;
}

function renderHarness(props: Omit<HarnessProps, "onBanner">) {
  const container = document.createElement("div");
  let latest: string[] = [];
  let root: Root;
  const render = (p: Omit<HarnessProps, "onBanner">) =>
    root.render(<Harness {...p} onBanner={(b) => (latest = b)} />);
  act(() => {
    root = createRoot(container);
    render(props);
  });
  return {
    banner: () => latest,
    rerender: (p: Omit<HarnessProps, "onBanner">) => act(() => render(p)),
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAssetBanner (#524)", () => {
  it("surfaces a render-collected prefix the host-side scan missed", () => {
    // Host scan found nothing (ref lives only in a prompt body / field value),
    // but getAssetURL saw asset://diagrams/ unresolved.
    const h = renderHarness({
      unmapped: [],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: ["diagrams"],
    });
    expect(h.banner()).toEqual(["diagrams"]);
    h.unmount();
  });

  it("unions the host-side scan with render-collected prefixes (sorted)", () => {
    const h = renderHarness({
      unmapped: ["recordings"],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: ["diagrams"],
    });
    expect(h.banner()).toEqual(["diagrams", "recordings"]);
    h.unmount();
  });

  it("does not collect a mounted prefix", () => {
    const h = renderHarness({
      unmapped: [],
      assetRoots: { diagrams: "https://webview/d" },
      contentVersion: 1,
      refsToRender: ["diagrams"],
    });
    expect(h.banner()).toEqual([]);
    h.unmount();
  });

  it("converges (a redundant re-render produces the same banner, no loop)", () => {
    const props = {
      unmapped: [] as string[],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: ["a", "b"],
    };
    const h = renderHarness(props);
    expect(h.banner()).toEqual(["a", "b"]);
    // A no-op re-render must not thrash — same banner (act would hang on a loop).
    h.rerender(props);
    expect(h.banner()).toEqual(["a", "b"]);
    h.unmount();
  });

  it("accumulates prefixes seen across renders within the same treatment", () => {
    const h = renderHarness({
      unmapped: [],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: ["a"],
    });
    expect(h.banner()).toEqual(["a"]);
    // Same treatment, a different stage now references `b` — `a` persists.
    h.rerender({
      unmapped: [],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: ["b"],
    });
    expect(h.banner()).toEqual(["a", "b"]);
    h.unmount();
  });

  it("resets the accumulation on a new treatment (contentVersion change)", () => {
    const h = renderHarness({
      unmapped: [],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: ["a"],
    });
    expect(h.banner()).toEqual(["a"]);
    h.rerender({
      unmapped: [],
      assetRoots: {},
      contentVersion: 2,
      refsToRender: ["b"],
    });
    expect(h.banner()).toEqual(["b"]); // 'a' dropped — fresh treatment
    h.unmount();
  });

  it("drops a prefix once it becomes mounted (pick → new roots + version)", () => {
    const h = renderHarness({
      unmapped: [],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: ["diagrams"],
    });
    expect(h.banner()).toEqual(["diagrams"]);
    // Simulate a pick: diagrams mounted, treatment re-posted (version bump).
    h.rerender({
      unmapped: [],
      assetRoots: { diagrams: "https://webview/d" },
      contentVersion: 2,
      refsToRender: ["diagrams"],
    });
    expect(h.banner()).toEqual([]);
    h.unmount();
  });

  it("drops a prefix via the mounted-filter alone (assetRoots change, same version)", () => {
    const h = renderHarness({
      unmapped: [],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: ["diagrams"],
    });
    expect(h.banner()).toEqual(["diagrams"]);
    // Same treatment (version unchanged), so the accumulated ref still holds
    // 'diagrams' — but it's now mounted, so mergeBannerPrefixes filters it out.
    // Exercises the mounted-filter path independent of the version reset.
    h.rerender({
      unmapped: [],
      assetRoots: { diagrams: "https://webview/d" },
      contentVersion: 1,
      refsToRender: ["diagrams"],
    });
    expect(h.banner()).toEqual([]);
    h.unmount();
  });

  it("keeps collectUnresolved referentially stable across renders (getAssetURL contract)", () => {
    const collectors: Array<(p: string) => void> = [];
    const base = {
      unmapped: [] as string[],
      assetRoots: {},
      contentVersion: 1,
      refsToRender: [] as string[],
      onCollector: (c: (p: string) => void) => collectors.push(c),
    };
    const h = renderHarness(base);
    h.rerender({ ...base, refsToRender: ["a"] });
    h.rerender({ ...base, contentVersion: 2 });
    // A fresh identity each render would recreate contentFns → getAssetURL →
    // PreviewHost re-fetch loop. Every render must hand back the same collector.
    expect(collectors.length).toBeGreaterThan(1);
    expect(collectors.every((c) => c === collectors[0])).toBe(true);
    h.unmount();
  });
});
