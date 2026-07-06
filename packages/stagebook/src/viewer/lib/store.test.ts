import { describe, it, expect } from "vitest";
import { ViewerStateStore, createViewerStateStore } from "./store.js";

describe("createViewerStateStore", () => {
  it("returns a fresh, working ViewerStateStore instance", () => {
    const store = createViewerStateStore();
    expect(store).toBeInstanceOf(ViewerStateStore);
    store.save("prompt_q1", { value: "yes" }, "player", 0, 2);
    expect(store.lookup("prompt_q1", 0)).toEqual([{ value: "yes" }]);
  });

  it("returns independent stores on each call", () => {
    const a = createViewerStateStore();
    const b = createViewerStateStore();
    a.save("k", 1, "player", 0, 0);
    expect(b.lookup("k", 0)).toEqual([]);
  });
});

describe("ViewerStateStore", () => {
  describe("save and get", () => {
    it("stores and retrieves a player-scoped value", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "yes" }, "player", 0, 2);
      expect(store.get(0, "prompt_q1")).toEqual({
        value: { value: "yes" },
        setOnStageIndex: 2,
      });
    });

    it("stores and retrieves a shared-scoped value", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "yes" }, "shared", 0, 1);
      expect(store.get("shared", "prompt_q1")).toEqual({
        value: { value: "yes" },
        setOnStageIndex: 1,
      });
    });

    it("overwrites an existing value", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "yes" }, "player", 0, 1);
      store.save("prompt_q1", { value: "no" }, "player", 0, 2);
      expect(store.get(0, "prompt_q1")?.value).toEqual({ value: "no" });
      expect(store.get(0, "prompt_q1")?.setOnStageIndex).toBe(2);
    });

    it("returns undefined for missing keys", () => {
      const store = new ViewerStateStore();
      expect(store.get(0, "prompt_missing")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("returns all entries across positions", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "a" }, "player", 0, 0);
      store.save("prompt_q1", { value: "b" }, "player", 1, 0);
      store.save("prompt_q2", { value: "c" }, "shared", 0, 1);

      const all = store.getAll();
      expect(all).toHaveLength(3);
    });
  });

  describe("lookup", () => {
    it("looks up a value for a specific position", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "yes" }, "player", 0, 0);
      const values = store.lookup("prompt_q1", 0);
      expect(values).toEqual([{ value: "yes" }]);
    });

    it("looks up values across all positions", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "yes" }, "player", 0, 0);
      store.save("prompt_q1", { value: "no" }, "player", 1, 0);
      const values = store.lookup("prompt_q1");
      expect(values).toEqual([{ value: "yes" }, { value: "no" }]);
    });

    it("looks up a shared value", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "shared-val" }, "shared", 0, 0);
      const values = store.lookup("prompt_q1", "shared");
      expect(values).toEqual([{ value: "shared-val" }]);
    });

    it("returns empty array for missing keys", () => {
      const store = new ViewerStateStore();
      const values = store.lookup("prompt_missing", 0);
      expect(values).toEqual([]);
    });
  });

  describe("submitted and elapsedTime", () => {
    it("tracks submitted state per stage", () => {
      const store = new ViewerStateStore();
      expect(store.getSubmitted(0)).toBe(false);
      store.setSubmitted(0, true);
      expect(store.getSubmitted(0)).toBe(true);
      store.setSubmitted(0, false);
      expect(store.getSubmitted(0)).toBe(false);
    });

    it("tracks elapsed time per stage", () => {
      const store = new ViewerStateStore();
      expect(store.getElapsedTime(0)).toBe(0);
      store.setElapsedTime(0, 45);
      expect(store.getElapsedTime(0)).toBe(45);
    });
  });

  describe("set (direct write for inspector)", () => {
    it("allows setting a value directly by position and key", () => {
      const store = new ViewerStateStore();
      store.set(0, "prompt_q1", { value: "injected" }, 1);
      expect(store.get(0, "prompt_q1")).toEqual({
        value: { value: "injected" },
        setOnStageIndex: 1,
      });
    });
  });

  describe("delete", () => {
    it("removes a player-scoped entry so lookup returns []", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "yes" }, "player", 0, 0);
      store.delete(0, "prompt_q1");
      expect(store.lookup("prompt_q1", 0)).toEqual([]);
      expect(store.get(0, "prompt_q1")).toBeUndefined();
    });

    it("removes a shared entry", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "yes" }, "shared", 0, 0);
      store.delete("shared", "prompt_q1");
      expect(store.lookup("prompt_q1", "shared")).toEqual([]);
    });

    it("prunes the position bucket when its last entry is removed", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "a" }, "player", 0, 0);
      store.save("prompt_q2", { value: "b" }, "player", 1, 0);
      store.delete(0, "prompt_q1");
      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.positionKey).toBe(1);
    });

    it("is a no-op for missing keys (and does not notify)", () => {
      const store = new ViewerStateStore();
      const calls: unknown[] = [];
      store.onChange(() => calls.push("changed"));
      store.delete(0, "prompt_missing");
      expect(calls).toEqual([]);
    });

    it("notifies listeners on successful delete", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "yes" }, "player", 0, 0);
      const calls: unknown[] = [];
      store.onChange(() => calls.push("changed"));
      store.delete(0, "prompt_q1");
      expect(calls).toEqual(["changed"]);
    });
  });

  describe("clearAll", () => {
    it("wipes all data, submitted flags, and elapsed time", () => {
      const store = new ViewerStateStore();
      store.save("prompt_q1", { value: "a" }, "player", 0, 0);
      store.save("prompt_q2", { value: "b" }, "shared", 0, 1);
      store.setSubmitted(0, true);
      store.setElapsedTime(0, 30);

      store.clearAll();

      expect(store.getAll()).toEqual([]);
      expect(store.getSubmitted(0)).toBe(false);
      expect(store.getElapsedTime(0)).toBe(0);
    });

    it("notifies listeners", () => {
      const store = new ViewerStateStore();
      const calls: unknown[] = [];
      store.onChange(() => calls.push("changed"));
      store.clearAll();
      expect(calls).toEqual(["changed"]);
    });
  });

  describe("onChange", () => {
    it("notifies listeners on save", () => {
      const store = new ViewerStateStore();
      const calls: unknown[] = [];
      store.onChange(() => calls.push("changed"));
      store.save("prompt_q1", { value: "yes" }, "player", 0, 0);
      expect(calls).toEqual(["changed"]);
    });

    it("notifies listeners on set", () => {
      const store = new ViewerStateStore();
      const calls: unknown[] = [];
      store.onChange(() => calls.push("changed"));
      store.set(0, "prompt_q1", { value: "yes" }, 0);
      expect(calls).toEqual(["changed"]);
    });

    it("returns an unsubscribe function", () => {
      const store = new ViewerStateStore();
      const calls: unknown[] = [];
      const unsub = store.onChange(() => calls.push("changed"));
      store.save("prompt_q1", { value: "a" }, "player", 0, 0);
      unsub();
      store.save("prompt_q1", { value: "b" }, "player", 0, 0);
      expect(calls).toEqual(["changed"]);
    });
  });
});
