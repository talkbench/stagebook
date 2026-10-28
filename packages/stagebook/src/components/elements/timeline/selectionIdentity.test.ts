import { expect, test } from "vitest";
import {
  restoreSelectionIdentity,
  saveSelectionIdentity,
} from "./selectionIdentity.js";
import { checkHostRecord } from "../../../schemas/hostRecords.js";

const tracks = [{ position: 0 }, { position: 5 }];
test("breakout selections round-trip by participant, not display row", () => {
  const internal = [{ start: 1, end: 2, track: 1 }];
  const saved = saveSelectionIdentity(internal, tracks);
  expect(saved).toEqual([{ start: 1, end: 2, position: 5 }]);
  expect(restoreSelectionIdentity(saved, tracks)).toEqual(internal);
  expect(restoreSelectionIdentity(saved, [...tracks].reverse())).toEqual([
    { start: 1, end: 2, track: 0 },
  ]);
  expect(checkHostRecord("timeline", saved).success).toBe(true);
});
test("all-track selections and ordinary row selections keep their meanings", () => {
  expect(saveSelectionIdentity([{ time: 1 }], tracks)).toEqual([{ time: 1 }]);
  expect(saveSelectionIdentity([{ time: 1, track: 1 }])).toEqual([
    { time: 1, track: 1 },
  ]);
  expect(restoreSelectionIdentity([{ time: 1, track: 1 }])).toEqual([
    { time: 1, track: 1 },
  ]);
});
test("never restore a different participant or reinterpret a legacy row as a participant", () => {
  expect(
    restoreSelectionIdentity(
      [
        { time: 1, position: 3 },
        { time: 2, track: 1 },
        { time: 3, track: 1, position: 5 },
        { time: 4, position: 5 },
      ],
      tracks,
    ),
  ).toEqual([{ time: 4, track: 1 }]);
  expect(restoreSelectionIdentity([{ time: 4, position: 5 }])).toEqual([]);
  expect(() =>
    saveSelectionIdentity([{ time: 1, track: 2 }], tracks),
  ).toThrow();
});
test.each([-1, 0.5, "5", null, Infinity])(
  "host contract rejects invalid position %j",
  (position) => {
    expect(checkHostRecord("timeline", [{ time: 1, position }]).success).toBe(
      false,
    );
  },
);
test("host contract rejects ambiguous track + position", () => {
  expect(
    checkHostRecord("timeline", [{ time: 1, track: 1, position: 5 }]).success,
  ).toBe(false);
});
