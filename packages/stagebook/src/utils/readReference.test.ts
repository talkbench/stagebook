import { describe, expect, test, vi } from "vitest";
import { Missing } from "../expressions/missing.js";
import { readReference } from "./readReference.js";

describe("readReference (#757)", () => {
  test.each([
    ["self.prompt.answer.value", {}, "player"],
    ["self.prompt.answer.value", { position: 2 }, "2"],
    ["shared.prompt.answer.value", {}, "shared"],
    ["0.prompt.answer.value", {}, "0"],
    ["3.prompt.answer.value", { position: 2 }, "3"],
  ])(
    "reads %s as one value from the correct scope",
    (reference, context, scope) => {
      const get = vi.fn(() => [{ value: "answer" }]);
      expect(readReference(reference, get, context)).toBe("answer");
      expect(get).toHaveBeenCalledWith("prompt_answer", scope);
      expect(get).toHaveBeenCalledTimes(1);
    },
  );
  test("structured and dotted forms share key, path, scope and normalization", () => {
    const get = vi.fn(() => [{ value: 7 }]);
    expect(readReference("2.prompt.answer.value", get, {})).toBe(7);
    expect(
      readReference(
        { position: 2, source: "prompt", name: "answer", path: ["value"] },
        get,
        {},
      ),
    ).toBe(7);
    expect(get.mock.calls).toEqual([
      ["prompt_answer", "2"],
      ["prompt_answer", "2"],
    ]);
  });
  test("preserves a list answer as the single position's value", () => {
    const value = Object.freeze(["red", "blue"]);
    expect(
      readReference("self.prompt.answer.value", () => [{ value }], {}),
    ).toEqual(["red", "blue"]);
    expect(value).toEqual(["red", "blue"]);
  });
  test("group reads use numeric seat order and never the old all scope", () => {
    const records = new Map([
      ["2", [{ value: "seat 2" }]],
      ["0", [{ value: "seat 0" }]],
    ]);
    const get = vi.fn(
      (_key: string, scope: string) => records.get(scope) ?? [],
    );
    expect(
      readReference("everyone.prompt.answer.value", get, { playerCount: 4 }),
    ).toEqual(["seat 0", Missing, "seat 2", Missing]);
    expect(get.mock.calls).toEqual([
      ["prompt_answer", "0"],
      ["prompt_answer", "1"],
      ["prompt_answer", "2"],
      ["prompt_answer", "3"],
    ]);
  });
  test("per-seat group normalization does not remove missing or blank seats", () => {
    const answers = [undefined, " ", 0, false, [], ["a", "b"], null];
    const get = vi.fn((_key: string, scope: string) => [
      { value: answers[Number(scope)] },
    ]);
    expect(
      readReference(
        { position: "everyone", source: "prompt", name: "answer" },
        get,
        { playerCount: answers.length },
      ),
    ).toEqual([Missing, Missing, 0, false, Missing, ["a", "b"], Missing]);
  });
  test("a known empty roster is a present empty group", () => {
    const get = vi.fn();
    expect(
      readReference("everyone.prompt.answer", get, { playerCount: 0 }),
    ).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
  test.each([undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "an unavailable or invalid roster %s is an explicit readiness error",
    (playerCount) => {
      const get = vi.fn();
      expect(() =>
        readReference("everyone.prompt.answer", get, { playerCount }),
      ).toThrow(/ready snapshot.*playerCount/i);
      expect(get).not.toHaveBeenCalled();
    },
  );
  test.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid self context.position %s before reading",
    (position) => {
      const get = vi.fn();
      expect(() =>
        readReference("self.prompt.answer", get, { position }),
      ).toThrow(/position.*non-negative.*integer/i);
      expect(get).not.toHaveBeenCalled();
    },
  );
  test.each([undefined, null, "", " \t\n", []].map((value) => ({ value })))(
    "normalizes blank prompt .value %j",
    ({ value }) => {
      const get = () => [{ value, isValid: true }];
      expect(readReference("self.prompt.answer.value", get, {})).toBe(Missing);
      expect(readReference("self.prompt.answer", get, {})).toBe(Missing);
      expect(
        readReference(
          { position: "self", source: "prompt", name: "answer" },
          get,
          {},
        ),
      ).toBe(Missing);
    },
  );
  test.each([0, false, "0", " false ", ["red"]].map((value) => ({ value })))(
    "preserves present prompt .value %j",
    ({ value }) => {
      expect(
        readReference("self.prompt.answer.value", () => [{ value }], {}),
      ).toEqual(value);
    },
  );
  test("non-answer fields and other sources preserve blank strings and lists", () => {
    expect(
      readReference("self.prompt.answer.entry", () => [{ entry: "" }], {}),
    ).toBe("");
    expect(readReference("self.timeline.selection", () => [[]], {})).toEqual(
      [],
    );
    expect(
      readReference("self.attributes.label", () => [{ label: " " }], {}),
    ).toBe(" ");
  });
  test("explicit empty path addresses the unmodified record, not its answer", () => {
    const record = Object.freeze({ value: "", isValid: true });
    expect(
      readReference(
        { position: "self", source: "prompt", name: "answer", path: [] },
        () => [record],
        {},
      ),
    ).toBe(record);
  });
  test("missing numericResponse value remains Missing while entry is readable", () => {
    const get = () => [{ entry: "1e", isValid: false }];
    expect(readReference("self.prompt.number.value", get, {})).toBe(Missing);
    expect(readReference("self.prompt.number.entry", get, {})).toBe("1e");
  });
  test.each([[], [undefined], [null], [{}]].map((records) => ({ records })))(
    "absent records and optional paths are Missing",
    ({ records }) => {
      expect(readReference("self.prompt.answer.value", () => records, {})).toBe(
        Missing,
      );
    },
  );
  test("normalizes null and undefined list members without dropping positions", () => {
    const value = Object.freeze(["red", null, undefined, ""]);
    expect(
      readReference("self.prompt.answer.value", () => [{ value }], {}),
    ).toEqual(["red", Missing, Missing, ""]);
    expect(value).toEqual(["red", null, undefined, ""]);
  });
  test("normalizes a shared array once and preserves its aliases", () => {
    let reads = 0;
    let value: unknown[] = [null];
    const depth = 12;
    for (let level = 0; level < depth; level++) {
      const child = value;
      value = Array.from({ length: 2 });
      for (const index of [0, 1]) {
        Object.defineProperty(value, index, {
          get() {
            reads++;
            return child;
          },
        });
      }
    }

    let result = readReference("self.timeline.selection", () => [value]);
    expect(reads).toBe(depth * 2);
    for (let level = 0; level < depth; level++) {
      expect(Array.isArray(result)).toBe(true);
      const members = result as unknown[];
      expect(members[0]).toBe(members[1]);
      result = members[0];
    }
    expect(result).toEqual([Missing]);
  });
  test("cyclic array edges become Missing while completed aliases are reused", () => {
    const cycle: unknown[] = [null];
    cycle.push(cycle);
    const value = [cycle, cycle];
    const result = readReference("self.timeline.selection", () => [
      value,
    ]) as unknown[];
    expect(result).toEqual([
      [Missing, Missing],
      [Missing, Missing],
    ]);
    expect(result[0]).toBe(result[1]);
    expect(cycle[0]).toBeNull();
    expect(cycle[1]).toBe(cycle);
  });
  test("rejects oversized arrays before reading any participant list members", () => {
    let reads = 0;
    const value = new Proxy(new Array<unknown>(100_001), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const result = readReference("self.timeline.selection", () => [value]);
    expect(reads).toBe(0);
    expect(result === Missing).toBe(true);
  });
  test("retains a flat list at the 10,000-node normalization boundary", () => {
    const value = Array.from({ length: 9_999 }, (_, index) => index);
    const result = readReference("self.timeline.selection", () => [value]);
    expect(result).toEqual(value);
    expect(result).not.toBe(value);
  });
  test("total nested-list exhaustion returns Missing and stops reading later members", () => {
    const later = vi.fn(() => 1);
    const second = vi.fn(() => 1);
    const child = new Array<unknown>(5_000);
    Object.defineProperty(child, 0, { get: second });
    const value = [Array.from({ length: 5_000 }, () => 1), child, null];
    Object.defineProperty(value, 2, { get: later });
    const result = readReference("self.timeline.selection", () => [value]);
    expect(second).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    expect(result === Missing).toBe(true);
  });
  test("everyone preserves all roster slots with independent stored-value budgets", () => {
    const oversized = new Array<unknown>(100_001);
    const valid = Array.from({ length: 9_999 }, () => 1);
    const get = vi.fn((_key: string, scope: string) => [
      scope === "0" ? oversized : valid,
    ]);
    const result = readReference("everyone.timeline.selection", get, {
      playerCount: 3,
    }) as unknown[];
    expect(get).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(3);
    expect(result[0] === Missing).toBe(true);
    expect(result[1]).toEqual(valid);
    expect(result[2]).toEqual(valid);
  });
  test("returns wrong host value types for the evaluator's typed diagnostics", () => {
    const wrong = () => "not stored JSON";
    expect(
      readReference("self.prompt.answer.value", () => [{ value: wrong }], {}),
    ).toBe(wrong);
  });
  test("traverses numeric paths and preserves raw string length", () => {
    expect(
      readReference(
        "self.timeline.selection.0.start",
        () => [[{ start: 2, end: 3 }]],
        {},
      ),
    ).toBe(2);
    expect(
      readReference(
        "self.prompt.answer.value.length",
        () => [{ value: "🙂" }],
        {},
      ),
    ).toBe(2);
  });
  test("blocked or inherited paths cannot expose object prototypes", () => {
    for (const path of ["__proto__", "constructor", "prototype", "toString"]) {
      expect(readReference(`self.attributes.${path}`, () => [{}], {})).toBe(
        Missing,
      );
    }
  });
  test("legacy all gets the parser's migration diagnostic", () => {
    const get = vi.fn();
    expect(() => readReference("all.prompt.answer", get, {})).toThrow(
      /all.*renamed.*everyone/i,
    );
    expect(get).not.toHaveBeenCalled();
  });
  test("host exceptions are not disguised as absent participant data", () => {
    expect(() =>
      readReference(
        "self.prompt.answer",
        () => {
          throw new Error("snapshot loading");
        },
        {},
      ),
    ).toThrow("snapshot loading");
  });
});
