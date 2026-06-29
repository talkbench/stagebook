import { describe, it, expect, vi } from "vitest";
import { createViewerContext } from "./context";
import { ViewerStateStore } from "./store";

const BASE_URL = "https://raw.githubusercontent.com/org/repo/main/treatments/";

function makeContext(overrides?: {
  position?: number;
  stageIndex?: number;
  playerCount?: number;
  locale?: string;
  onSubmit?: () => void;
}) {
  const store = new ViewerStateStore();
  const ctx = createViewerContext({
    store,
    position: overrides?.position ?? 0,
    stageIndex: overrides?.stageIndex ?? 0,
    playerCount: overrides?.playerCount ?? 2,
    locale: overrides?.locale,
    onSubmit: overrides?.onSubmit ?? (() => {}),
    getAssetURL: (path: string) => BASE_URL + path,
    getTextContent: (path: string) =>
      fetch(BASE_URL + path).then((r) => r.text()),
  });
  return { store, ctx };
}

describe("createViewerContext", () => {
  describe("save and get", () => {
    it("save writes to store and get reads back raw values", () => {
      const { ctx } = makeContext();
      ctx.save("prompt_q1", { value: "yes" });
      const values = ctx.get("prompt_q1", "player");
      expect(values).toEqual([{ value: "yes" }]);
    });

    it("defaults to player scope", () => {
      const { store, ctx } = makeContext({ position: 0 });
      ctx.save("prompt_q1", { value: "yes" });
      // Should be stored under position 0
      expect(store.get(0, "prompt_q1")).toBeDefined();
      expect(store.get("shared", "prompt_q1")).toBeUndefined();
    });

    it("respects shared scope", () => {
      const { store, ctx } = makeContext();
      ctx.save("prompt_q1", { value: "shared-val" }, "shared");
      expect(store.get("shared", "prompt_q1")).toBeDefined();
    });

    it("get with numeric string scope reads that position", () => {
      const { store, ctx } = makeContext({ position: 0 });
      store.save("prompt_q1", { value: "from-pos-1" }, "player", 1, 0);
      const values = ctx.get("prompt_q1", "1");
      expect(values).toEqual([{ value: "from-pos-1" }]);
    });

    it("get with 'all' returns raw values from all positions", () => {
      const { store, ctx } = makeContext();
      store.save("prompt_q1", { value: "a" }, "player", 0, 0);
      store.save("prompt_q1", { value: "b" }, "player", 1, 0);
      const values = ctx.get("prompt_q1", "all");
      expect(values).toEqual([{ value: "a" }, { value: "b" }]);
    });

    it("get with non-finite numeric scope falls back to current position", () => {
      // Number("Infinity"), Number("-Infinity"), and negative numbers
      // must not be accepted as position indices.
      const { store, ctx } = makeContext({ position: 0 });
      store.save("prompt_q1", { value: "own" }, "player", 0, 0);
      expect(ctx.get("prompt_q1", "Infinity")).toEqual([{ value: "own" }]);
      expect(ctx.get("prompt_q1", "-Infinity")).toEqual([{ value: "own" }]);
      expect(ctx.get("prompt_q1", "-1")).toEqual([{ value: "own" }]);
      expect(ctx.get("prompt_q1", "1.5")).toEqual([{ value: "own" }]);
    });
  });

  describe("submit", () => {
    it("calls the onSubmit callback", () => {
      const onSubmit = vi.fn();
      const { ctx } = makeContext({ onSubmit });
      ctx.submit();
      expect(onSubmit).toHaveBeenCalledOnce();
    });
  });

  describe("getAssetURL", () => {
    it("constructs a raw GitHub URL relative to the base", () => {
      const { ctx } = makeContext();
      const url = ctx.getAssetURL("images/photo.png");
      expect(url).toBe(
        "https://raw.githubusercontent.com/org/repo/main/treatments/images/photo.png",
      );
    });
  });

  describe("getTextContent", () => {
    it("delegates to the provided getTextContent function", async () => {
      const mockGetTextContent = vi.fn().mockResolvedValue("file contents");
      const store = new ViewerStateStore();
      const ctx = createViewerContext({
        store,
        position: 0,
        stageIndex: 0,
        playerCount: 2,
        onSubmit: () => {},
        getAssetURL: (path: string) => BASE_URL + path,
        getTextContent: mockGetTextContent,
      });
      const result = await ctx.getTextContent("prompts/q1.prompt.md");
      expect(result).toBe("file contents");
      expect(mockGetTextContent).toHaveBeenCalledWith("prompts/q1.prompt.md");
    });
  });

  describe("metadata fields", () => {
    it("exposes position, playerCount, playerId", () => {
      const { ctx } = makeContext({ position: 1, playerCount: 3 });
      expect(ctx.position).toBe(1);
      expect(ctx.playerCount).toBe(3);
      expect(ctx.playerId).toBe("viewer");
    });

    it("exposes isSubmitted based on store state", () => {
      const { store, ctx } = makeContext({ stageIndex: 2 });
      expect(ctx.isSubmitted).toBe(false);
      store.setSubmitted(2, true);
      expect(ctx.isSubmitted).toBe(true);
    });

    it("exposes getElapsedTime from store", () => {
      const { store, ctx } = makeContext({ stageIndex: 1 });
      expect(ctx.getElapsedTime()).toBe(0);
      store.setElapsedTime(1, 30);
      expect(ctx.getElapsedTime()).toBe(30);
    });
  });

  // The provider reports a contract violation without
  // `attributes.stableParticipantId` (#473). The viewer synthesizes a
  // per-position default so previews stay clean.
  describe("attributes default (#473)", () => {
    it("synthesizes a per-position stableParticipantId when nothing is stored", () => {
      const { ctx } = makeContext({ position: 2 });
      expect(ctx.get("attributes", "player")).toEqual([
        { stableParticipantId: "viewer-p2" },
      ]);
    });

    it("lets a seeded non-empty stableParticipantId override the default", () => {
      const { store, ctx } = makeContext({ position: 0 });
      store.set(0, "attributes", { stableParticipantId: "seeded-id" }, 0);
      expect(ctx.get("attributes", "player")).toEqual([
        { stableParticipantId: "seeded-id" },
      ]);
    });

    it("merges the default id under other seeded attribute fields", () => {
      const { store, ctx } = makeContext({ position: 0 });
      store.set(0, "attributes", { country: "US" }, 0);
      expect(ctx.get("attributes", "player")).toEqual([
        { country: "US", stableParticipantId: "viewer-p0" },
      ]);
    });

    it("does NOT let a stored empty-string id clobber the default (would trigger a contract violation)", () => {
      const { store, ctx } = makeContext({ position: 1 });
      store.set(1, "attributes", { stableParticipantId: "" }, 0);
      expect(ctx.get("attributes", "player")).toEqual([
        { stableParticipantId: "viewer-p1" },
      ]);
    });
  });
});

describe("locale threading", () => {
  it("places the locale option onto the context (drives chrome + RTL)", () => {
    const { ctx } = makeContext({ locale: "he" });
    expect(ctx.locale).toBe("he");
  });

  it("leaves locale undefined when omitted (stagebook defaults to en)", () => {
    const { ctx } = makeContext();
    expect(ctx.locale).toBeUndefined();
  });
});
