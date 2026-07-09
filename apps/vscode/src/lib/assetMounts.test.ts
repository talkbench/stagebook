import { describe, it, expect } from "vitest";
import * as path from "path";
import {
  mergeAssetMounts,
  splitAssetMounts,
  extraAssetRoots,
} from "./assetMounts.js";

// Build an OS-appropriate absolute path so these run on POSIX and Windows CI.
const abs = (...segs: string[]) => path.join(path.sep, ...segs);

describe("mergeAssetMounts (#192)", () => {
  const WS = path.join(path.sep, "ws", "study");

  it("resolves a relative setting path against the workspace root", () => {
    expect(mergeAssetMounts({ diagrams: "media/diagrams" }, {}, WS)).toEqual({
      diagrams: path.join(WS, "media/diagrams"),
    });
  });

  it("passes an absolute setting path through unchanged", () => {
    const abs = path.join(path.sep, "Users", "me", "videos");
    expect(mergeAssetMounts({ recordings: abs }, {}, WS)).toEqual({
      recordings: abs,
    });
  });

  it("lets an interactive pick override the setting for the same prefix", () => {
    const pick = path.join(path.sep, "Users", "me", "local_videos");
    expect(
      mergeAssetMounts({ recordings: "media/rec" }, { recordings: pick }, WS),
    ).toEqual({ recordings: pick });
  });

  it("unions distinct prefixes from both sources", () => {
    const pick = path.join(path.sep, "tmp", "clips");
    expect(
      mergeAssetMounts({ diagrams: "media/d" }, { clips: pick }, WS),
    ).toEqual({
      diagrams: path.join(WS, "media/d"),
      clips: pick,
    });
  });

  it("skips empty or non-string values in either source", () => {
    expect(
      mergeAssetMounts(
        { a: "", b: 42 as unknown as string, c: "media/c" },
        { d: null as unknown as string, e: path.join(path.sep, "e") },
        WS,
      ),
    ).toEqual({ c: path.join(WS, "media/c"), e: path.join(path.sep, "e") });
  });

  it("passes a relative setting path through unchanged when there is no workspace root", () => {
    // Can't resolve it; leave it as-is (the caller then fails to load it).
    expect(mergeAssetMounts({ x: "media/x" }, {}, undefined)).toEqual({
      x: "media/x",
    });
  });

  it("still applies absolute picks with no workspace root", () => {
    const pick = path.join(path.sep, "abs", "pick");
    expect(mergeAssetMounts({}, { x: pick }, undefined)).toEqual({ x: pick });
  });
});

describe("splitAssetMounts (#192)", () => {
  it("routes mounted prefixes to `mounted` and the rest to `unmapped`", () => {
    const dirs = {
      recordings: "/a/rec",
      diagrams: "/a/dia",
    };
    expect(splitAssetMounts(["recordings", "clips", "diagrams"], dirs)).toEqual(
      {
        mounted: { recordings: "/a/rec", diagrams: "/a/dia" },
        unmapped: ["clips"],
      },
    );
  });

  it("preserves input order in `unmapped`", () => {
    expect(splitAssetMounts(["z", "a", "m"], {})).toEqual({
      mounted: {},
      unmapped: ["z", "a", "m"],
    });
  });

  it("treats an empty mount dir as unmapped", () => {
    expect(splitAssetMounts(["x"], { x: "" })).toEqual({
      mounted: {},
      unmapped: ["x"],
    });
  });

  it("returns empty results for no prefixes", () => {
    expect(splitAssetMounts([], { x: "/a" })).toEqual({
      mounted: {},
      unmapped: [],
    });
  });
});

describe("extraAssetRoots (#192 — reload-free in-workspace mounts)", () => {
  const WS = abs("ws", "study");
  const DIST = abs("ext", "dist");

  it("drops a mount INSIDE a covered root (already recursive → no new root)", () => {
    // The key fix: an in-workspace pick adds no root, so the panel's root set
    // is unchanged and the pick doesn't force a webview reload.
    expect(extraAssetRoots([abs("ws", "study", "media")], [DIST, WS])).toEqual(
      [],
    );
  });

  it("keeps a mount OUTSIDE every covered root", () => {
    const outside = abs("Users", "me", "videos");
    expect(extraAssetRoots([outside], [DIST, WS])).toEqual([outside]);
  });

  it("treats the workspace root itself as covered", () => {
    expect(extraAssetRoots([WS], [DIST, WS])).toEqual([]);
  });

  it("keeps a mount that is a PARENT of a covered root", () => {
    // Mounting /Users/me when /Users/me/study is the workspace legitimately
    // widens access — the parent is not covered by its child.
    const parent = abs("Users", "me");
    const child = abs("Users", "me", "study");
    expect(extraAssetRoots([parent], [DIST, child])).toEqual([parent]);
  });

  it("dedupes nested mounts against each other", () => {
    const outer = abs("data", "assets");
    const inner = abs("data", "assets", "clips");
    expect(extraAssetRoots([outer, inner], [DIST, WS])).toEqual([outer]);
  });

  it("dedupes identical mount dirs", () => {
    const d = abs("data", "x");
    expect(extraAssetRoots([d, d], [DIST, WS])).toEqual([d]);
  });

  it("preserves input order of the kept dirs", () => {
    const a = abs("z", "a");
    const b = abs("y", "b");
    expect(extraAssetRoots([a, b], [DIST, WS])).toEqual([a, b]);
  });

  it("skips empty / non-string entries", () => {
    const good = abs("data", "ok");
    expect(
      extraAssetRoots(["", good, undefined as unknown as string], [DIST, WS]),
    ).toEqual([good]);
  });
});
