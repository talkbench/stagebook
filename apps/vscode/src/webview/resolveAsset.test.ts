import { describe, it, expect, vi } from "vitest";
import {
  resolveAssetUrl,
  buildAssetURL,
  assetPrefixOf,
  reportUnresolvedAsset,
  resolveAssetForRender,
  mergeBannerPrefixes,
} from "./resolveAsset.js";

// #192: the webview resolves `asset://<prefix>/<rest>` against the mount map the
// extension pre-computed (`{ prefix -> asWebviewUri(<local dir>) }`). A matched,
// safe path becomes a loadable webview URL; anything unmatched or unsafe passes
// through unchanged so the #191 placeholder fires instead of a broken load.
const ROOTS = {
  group_recordings: "https://file+.vscode-resource.example/Users/me/videos",
  // A base WITHOUT a trailing slash — resolution must still join correctly.
  diagrams: "https://file+.vscode-resource.example/repo/media/diagrams",
};

describe("resolveAssetUrl (#192)", () => {
  it("resolves a mounted prefix to base + path", () => {
    expect(
      resolveAssetUrl("asset://group_recordings/session_01.mp4", ROOTS),
    ).toBe(
      "https://file+.vscode-resource.example/Users/me/videos/session_01.mp4",
    );
  });

  it("joins correctly when the base has no trailing slash", () => {
    expect(resolveAssetUrl("asset://diagrams/flow.png", ROOTS)).toBe(
      "https://file+.vscode-resource.example/repo/media/diagrams/flow.png",
    );
  });

  it("resolves nested subpaths under a mount", () => {
    expect(resolveAssetUrl("asset://group_recordings/day1/a.mp4", ROOTS)).toBe(
      "https://file+.vscode-resource.example/Users/me/videos/day1/a.mp4",
    );
  });

  it("returns the bare base when there is no rest", () => {
    expect(resolveAssetUrl("asset://group_recordings", ROOTS)).toBe(
      "https://file+.vscode-resource.example/Users/me/videos",
    );
    expect(resolveAssetUrl("asset://group_recordings/", ROOTS)).toBe(
      "https://file+.vscode-resource.example/Users/me/videos",
    );
  });

  it("percent-encodes each path segment but preserves separators", () => {
    expect(
      resolveAssetUrl("asset://group_recordings/day 1/a&b.mp4", ROOTS),
    ).toBe(
      "https://file+.vscode-resource.example/Users/me/videos/day%201/a%26b.mp4",
    );
  });

  it("ignores `.` and empty segments", () => {
    expect(
      resolveAssetUrl("asset://group_recordings/./sub//a.mp4", ROOTS),
    ).toBe("https://file+.vscode-resource.example/Users/me/videos/sub/a.mp4");
  });

  it("matches the scheme case-insensitively (fileSchema accepts ASSET://)", () => {
    expect(resolveAssetUrl("ASSET://group_recordings/a.mp4", ROOTS)).toBe(
      "https://file+.vscode-resource.example/Users/me/videos/a.mp4",
    );
  });

  it("passes an unmatched prefix through unchanged (→ #191 placeholder)", () => {
    expect(resolveAssetUrl("asset://unknown/a.mp4", ROOTS)).toBe(
      "asset://unknown/a.mp4",
    );
  });

  it("passes through unchanged (no resolution) when the path traverses upward", () => {
    // A treatment must not escape its mounted root; refuse to build the URL.
    expect(
      resolveAssetUrl("asset://group_recordings/../../etc/passwd", ROOTS),
    ).toBe("asset://group_recordings/../../etc/passwd");
    expect(
      resolveAssetUrl("asset://group_recordings/sub/../../secret", ROOTS),
    ).toBe("asset://group_recordings/sub/../../secret");
  });

  it("also rejects backslash-delimited traversal (cross-platform)", () => {
    // The `..` check splits on both separators, so a `..\..` can't slip past.
    expect(
      resolveAssetUrl("asset://group_recordings/..\\..\\secret", ROOTS),
    ).toBe("asset://group_recordings/..\\..\\secret");
    expect(
      resolveAssetUrl("asset://group_recordings/sub\\..\\..\\x", ROOTS),
    ).toBe("asset://group_recordings/sub\\..\\..\\x");
  });

  it("passes a non-asset input through unchanged", () => {
    expect(resolveAssetUrl("images/logo.png", ROOTS)).toBe("images/logo.png");
    expect(resolveAssetUrl("https://cdn.test/x.png", ROOTS)).toBe(
      "https://cdn.test/x.png",
    );
  });

  it("returns passthrough for every prefix when the mount map is empty", () => {
    expect(resolveAssetUrl("asset://group_recordings/a.mp4", {})).toBe(
      "asset://group_recordings/a.mp4",
    );
  });
});

describe("buildAssetURL (#192 getAssetURL routing)", () => {
  const BASE = "https://webview.example/study/";

  it("routes a mounted asset:// URI through the resolver", () => {
    expect(buildAssetURL("asset://group_recordings/s.mp4", BASE, ROOTS)).toBe(
      "https://file+.vscode-resource.example/Users/me/videos/s.mp4",
    );
  });

  it("returns an UNMAPPED asset:// URI unchanged (keeps #191 placeholder firing)", () => {
    // Critical: the passthrough must still be an `asset:` URI so Element's
    // isUnresolvedAsset detector fires — NOT base-joined into a broken URL.
    const out = buildAssetURL("asset://unknown/x.mp4", BASE, ROOTS);
    expect(out).toBe("asset://unknown/x.mp4");
    expect(out.startsWith("asset:")).toBe(true);
  });

  it("returns a traversal asset:// URI unchanged (not base-joined)", () => {
    const out = buildAssetURL("asset://group_recordings/../x", BASE, ROOTS);
    expect(out).toBe("asset://group_recordings/../x");
    expect(out.startsWith("asset:")).toBe(true);
  });

  it("base-joins a normal repo-relative path (leading slashes stripped)", () => {
    expect(buildAssetURL("images/logo.png", BASE, ROOTS)).toBe(
      "https://webview.example/study/images/logo.png",
    );
    expect(buildAssetURL("/images/logo.png", BASE, ROOTS)).toBe(
      "https://webview.example/study/images/logo.png",
    );
  });

  it("normalizes a base URI that lacks a trailing slash", () => {
    expect(buildAssetURL("a.png", "https://webview.example/study", ROOTS)).toBe(
      "https://webview.example/study/a.png",
    );
  });

  it("matches the asset:// scheme case-insensitively when routing", () => {
    // Same case-insensitivity as isUnresolvedAsset, so uppercase still routes.
    expect(buildAssetURL("ASSET://unknown/x.mp4", BASE, ROOTS)).toBe(
      "ASSET://unknown/x.mp4",
    );
  });
});

describe("assetPrefixOf (#524)", () => {
  it("extracts the prefix from an asset:// URI", () => {
    expect(assetPrefixOf("asset://diagrams/flow.png")).toBe("diagrams");
    expect(assetPrefixOf("asset://recordings/a/b.mp4")).toBe("recordings");
  });

  it("matches case-insensitively but preserves prefix case", () => {
    expect(assetPrefixOf("ASSET://Diagrams/x.png")).toBe("Diagrams");
  });

  it("handles a bare prefix with no rest", () => {
    expect(assetPrefixOf("asset://diagrams")).toBe("diagrams");
  });

  it("returns null for a non-asset path", () => {
    expect(assetPrefixOf("images/logo.png")).toBeNull();
    expect(assetPrefixOf("https://cdn/x.png")).toBeNull();
    expect(assetPrefixOf("asset:opaque.png")).toBeNull(); // no //host
  });
});

describe("reportUnresolvedAsset (#524)", () => {
  it("reports the prefix of an UNMOUNTED asset:// ref", () => {
    const onUnresolved = vi.fn();
    reportUnresolvedAsset("asset://diagrams/x.png", {}, onUnresolved);
    expect(onUnresolved).toHaveBeenCalledWith("diagrams");
  });

  it("does NOT report a mounted prefix", () => {
    const onUnresolved = vi.fn();
    reportUnresolvedAsset(
      "asset://diagrams/x.png",
      { diagrams: "https://webview/x" },
      onUnresolved,
    );
    expect(onUnresolved).not.toHaveBeenCalled();
  });

  it("does NOT report a non-asset path", () => {
    const onUnresolved = vi.fn();
    reportUnresolvedAsset("images/logo.png", {}, onUnresolved);
    expect(onUnresolved).not.toHaveBeenCalled();
  });

  it("reports an unmounted prefix even for a traversal ref (prefix is still real)", () => {
    const onUnresolved = vi.fn();
    reportUnresolvedAsset("asset://clips/../../x", {}, onUnresolved);
    expect(onUnresolved).toHaveBeenCalledWith("clips");
  });
});

describe("mergeBannerPrefixes (#524)", () => {
  it("unions the static scan with the render-collected set, sorted + deduped", () => {
    expect(
      mergeBannerPrefixes(
        ["recordings", "diagrams"],
        ["diagrams", "clips"],
        {},
      ),
    ).toEqual(["clips", "diagrams", "recordings"]);
  });

  it("drops any prefix that is now mounted (from either source)", () => {
    expect(
      mergeBannerPrefixes(["recordings"], ["diagrams", "clips"], {
        diagrams: "https://webview/d",
      }),
    ).toEqual(["clips", "recordings"]);
  });

  it("returns [] when everything is mounted or nothing is referenced", () => {
    expect(mergeBannerPrefixes([], [], {})).toEqual([]);
    expect(
      mergeBannerPrefixes(["x"], ["x"], { x: "https://webview/x" }),
    ).toEqual([]);
  });

  it("is order-independent (stable for change-detection)", () => {
    const a = mergeBannerPrefixes(["b", "a"], ["c"], {});
    const b = mergeBannerPrefixes(["a"], ["c", "b"], {});
    expect(a).toEqual(b);
    expect(a).toEqual(["a", "b", "c"]);
  });
});

describe("resolveAssetForRender (#524 getAssetURL seam)", () => {
  const BASE = "https://webview.example/study/";

  it("returns the resolved URL AND reports an unmounted asset:// prefix", () => {
    const onUnresolved = vi.fn();
    const url = resolveAssetForRender(
      "asset://diagrams/x.png",
      BASE,
      {},
      onUnresolved,
    );
    // Passthrough (unmounted) so #191 placeholder fires...
    expect(url).toBe("asset://diagrams/x.png");
    // ...and the prefix is reported for the banner.
    expect(onUnresolved).toHaveBeenCalledWith("diagrams");
  });

  it("resolves a mounted prefix and does NOT report it", () => {
    const onUnresolved = vi.fn();
    const url = resolveAssetForRender(
      "asset://group_recordings/s.mp4",
      BASE,
      ROOTS,
      onUnresolved,
    );
    expect(url).toBe(
      "https://file+.vscode-resource.example/Users/me/videos/s.mp4",
    );
    expect(onUnresolved).not.toHaveBeenCalled();
  });

  it("base-joins a normal path and reports nothing", () => {
    const onUnresolved = vi.fn();
    expect(
      resolveAssetForRender("images/logo.png", BASE, ROOTS, onUnresolved),
    ).toBe("https://webview.example/study/images/logo.png");
    expect(onUnresolved).not.toHaveBeenCalled();
  });
});
