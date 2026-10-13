import { describe, expect, test, vi } from "vitest";
import { readReference } from "../utils/readReference.js";
import { evaluateExpression, Missing } from "./evaluateExpression.js";

describe("length counts host array positions (#780)", () => {
  test.each([
    ["self.timeline.selection", [{ time: 5 }]],
    ["self.timeline.selection", [{ start: 1, end: 2 }]],
    ["self.trackedLink.link.events", { events: [{ type: "click" }] }],
    ["self.mediaPlayer.clip.events", { events: [{ type: "play" }] }],
    ["self.mediaPlayer.clip.watchedRanges", { watchedRanges: [[1, 2]] }],
  ])("counts a saved array at %s", (reference, record) => {
    const onViolation = vi.fn();
    const options = {
      readReference: (input: Parameters<typeof readReference>[0]) =>
        readReference(input, () => [record]),
      onViolation,
    };
    expect(evaluateExpression({ length: { reference } }, options)).toBe(1);
    for (const [comparator, value, expected] of [
      ["hasLengthAtLeast", 1, true],
      ["hasLengthAtLeast", 2, false],
      ["hasLengthAtMost", 1, true],
      ["hasLengthAtMost", 0, false],
    ] as const)
      expect(
        evaluateExpression({ reference, comparator, value }, options),
      ).toBe(expected);
    expect(onViolation).not.toHaveBeenCalled();
  });

  test.each(
    [
      [],
      [{ time: 1 }, { time: 2 }],
      [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ],
      [
        [1, 2],
        [3, 4],
      ],
      [{ time: 1 }, Missing, undefined, null],
    ].map((value) => ({ value })),
  )("counts all positions in $value", ({ value }) => {
    const onViolation = vi.fn();
    const options = { readReference: () => value, onViolation };
    const reference = "self.timeline.selection";
    expect(evaluateExpression({ length: { reference } }, options)).toBe(
      value.length,
    );
    for (const comparator of ["hasLengthAtLeast", "hasLengthAtMost"])
      expect(
        evaluateExpression(
          { reference, comparator, value: value.length },
          options,
        ),
      ).toBe(true);
    expect(onViolation).not.toHaveBeenCalled();
  });

  test("per-seat length leaves and outer group length have distinct counts", () => {
    const reference = "everyone.timeline.selection";
    const options = {
      readReference: () => [[{ time: 1 }, { time: 2 }], [], Missing],
      onViolation: vi.fn(),
    };
    expect(evaluateExpression({ length: { reference } }, options)).toBe(3);
    expect(
      evaluateExpression(
        { reference, comparator: "hasLengthAtLeast", value: 1 },
        options,
      ),
    ).toEqual([true, false, false]);
    expect(options.onViolation).not.toHaveBeenCalled();
  });

  test.each([
    { firstExisting: [null, { reference: "self.timeline.selection" }] },
    {
      case: {
        rules: [
          { when: true, value: { reference: "self.timeline.selection" } },
        ],
      },
    },
  ])("counts an array selected by a branch", (input) => {
    const onViolation = vi.fn();
    expect(
      evaluateExpression(
        { length: input },
        { readReference: () => [{ time: 1 }], onViolation },
      ),
    ).toBe(1);
    expect(onViolation).not.toHaveBeenCalled();
  });

  test.each([
    {
      firstExisting: [
        { reference: "self.timeline.selection" },
        { literal: [] },
      ],
    },
    {
      case: {
        rules: [
          { when: true, value: { reference: "self.timeline.selection" } },
          { default: true, value: { literal: [] } },
        ],
      },
    },
  ])(
    "an empty array fallback does not constrain array member types",
    (input) => {
      const onViolation = vi.fn();
      expect(
        evaluateExpression(
          { length: input },
          { readReference: () => [{ time: 1 }, [2, 3]], onViolation },
        ),
      ).toBe(2);
      expect(onViolation).not.toHaveBeenCalled();
    },
  );

  test.each([Missing, undefined, null, 2, false, { length: 2 }])(
    "does not treat %j as a string or array",
    (value) => {
      const reference = "self.timeline.selection";
      const options = { readReference: () => value };
      expect(evaluateExpression({ length: { reference } }, options)).toBe(
        Missing,
      );
      for (const comparator of ["hasLengthAtLeast", "hasLengthAtMost"])
        expect(
          evaluateExpression({ reference, comparator, value: 0 }, options),
        ).toBe(false);
    },
  );

  test("keeps content operators and authored array literals restricted", () => {
    const reference = { reference: "self.timeline.selection" };
    const options = { readReference: () => ["found", { time: 1 }] };
    expect(
      evaluateExpression(
        { includes: { container: reference, members: ["found"] } },
        options,
      ),
    ).toBe(false);
    expect(
      evaluateExpression({ allEqual: [reference, reference] }, options),
    ).toBe(false);
    expect(
      evaluateExpression(
        { allEqual: reference },
        { readReference: () => [["a"], ["a"]] },
      ),
    ).toBe(false);
    expect(evaluateExpression({ countExisting: reference }, options)).toBe(1);
    expect(evaluateExpression({ countUnique: reference }, options)).toBe(1);
    expect(
      evaluateExpression({ length: { literal: [{ time: 1 }] } }, options),
    ).toBe(Missing);
    expect(evaluateExpression({ length: { literal: [[1, 2]] } }, options)).toBe(
      Missing,
    );
  });
});
