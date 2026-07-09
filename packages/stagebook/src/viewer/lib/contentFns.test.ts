import { describe, it, expect, vi, afterEach } from "vitest";
import { createStaticContentFns, createUrlContentFns } from "./contentFns.js";

describe("createStaticContentFns", () => {
  it("resolves getTextContent from the provided file map", async () => {
    const fns = createStaticContentFns({
      "README.md": "# Study",
      "prompts/q1.prompt.md": "Question one",
    });
    await expect(fns.getTextContent("README.md")).resolves.toBe("# Study");
    await expect(fns.getTextContent("prompts/q1.prompt.md")).resolves.toBe(
      "Question one",
    );
  });

  it("rejects with the path when a file is not in the map", async () => {
    const fns = createStaticContentFns({ "a.md": "a" });
    await expect(fns.getTextContent("missing.md")).rejects.toThrow(
      /missing\.md/,
    );
  });

  it("distinguishes an empty-string file from a missing one", async () => {
    const fns = createStaticContentFns({ "empty.md": "" });
    await expect(fns.getTextContent("empty.md")).resolves.toBe("");
    await expect(fns.getTextContent("absent.md")).rejects.toThrow();
  });

  it("returns the path unchanged as an asset URL", () => {
    const fns = createStaticContentFns({});
    expect(fns.getAssetURL("images/logo.png")).toBe("images/logo.png");
  });
});

describe("createUrlContentFns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches text from baseUrl + path and returns it", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("hello", { status: 200 }));
    const fns = createUrlContentFns("https://raw.example.com/");
    await expect(fns.getTextContent("a.md")).resolves.toBe("hello");
    expect(fetchMock).toHaveBeenCalledWith("https://raw.example.com/a.md");
  });

  it("caches a successful fetch (no re-fetch for the same path)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("cached", { status: 200 }));
    const fns = createUrlContentFns("https://raw.example.com/");
    await fns.getTextContent("a.md");
    await fns.getTextContent("a.md");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws with the HTTP status on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 404 }),
    );
    const fns = createUrlContentFns("https://raw.example.com/");
    await expect(fns.getTextContent("missing.md")).rejects.toThrow(/404/);
  });

  it("evicts a failed fetch so a later call retries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response("recovered", { status: 200 }));
    const fns = createUrlContentFns("https://raw.example.com/");
    await expect(fns.getTextContent("flaky.md")).rejects.toThrow(/500/);
    // The failed promise was evicted from the cache, so a retry re-fetches.
    await expect(fns.getTextContent("flaky.md")).resolves.toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds asset URLs by concatenating base + path", () => {
    const fns = createUrlContentFns("https://raw.example.com/");
    expect(fns.getAssetURL("img/x.png")).toBe(
      "https://raw.example.com/img/x.png",
    );
  });

  it("returns an asset:// URI unchanged instead of concatenating (#191)", () => {
    // The viewer can't resolve platform assets — it returns the URI as-is so
    // the renderer shows a placeholder rather than fetching `<base>asset://…`.
    const fns = createUrlContentFns("https://raw.example.com/");
    expect(fns.getAssetURL("asset://group_recordings/session.mp4")).toBe(
      "asset://group_recordings/session.mp4",
    );
  });

  it("passes asset:// through case-insensitively (fileSchema accepts ASSET://)", () => {
    const fns = createUrlContentFns("https://raw.example.com/");
    expect(fns.getAssetURL("ASSET://x/y.mp4")).toBe("ASSET://x/y.mp4");
    expect(fns.getAssetURL("Asset://x/y.mp4")).toBe("Asset://x/y.mp4");
  });

  it("rejects asset:// text without fetching (platform-provided prompt) (#191)", async () => {
    // An asset:// prompt file must fail fast (no `<base>asset://…` request) so
    // the renderer falls back to the placeholder instead of a garbled fetch.
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const fns = createUrlContentFns("https://raw.example.com/");
    await expect(
      fns.getTextContent("asset://private/intro.prompt.md"),
    ).rejects.toThrow(/asset:\/\//);
    await expect(fns.getTextContent("ASSET://x.prompt.md")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
