import { expect, test } from "vitest";
import { en } from "./en.js";
import { he } from "./he.js";

test("numeric guidance describes whole/decimal and one/two-sided ranges", () => {
  expect(en.numericGuidance(true, "18", "99")).toBe(
    "Whole number from 18 to 99",
  );
  expect(en.numericGuidance(false, "0.0000001")).toBe(
    "Number at least 0.0000001",
  );
  expect(en.numericGuidance(false, undefined, "1000000")).toBe(
    "Number at most 1000000",
  );
  expect(en.numericGuidance(false)).toBe("Enter a number");
  expect(en.numericGuidance(true)).toBe("Enter a whole number");
  expect(en.numericLessThan("3", "18")).toBe("3 is less than 18");
  expect(en.numericMoreThan("25", "20")).toBe("25 is more than 20");
});

test("numeric parsing problems and the missing shared renderer have catalog messages", () => {
  for (const catalog of [en, he]) {
    for (const message of [
      catalog.numericWholeNumber,
      catalog.numericUnfinished,
      catalog.numericNotNumber,
      catalog.numericTooManyDigits,
      catalog.numericTooLong,
      catalog.sharedNumericUnavailable,
    ]) {
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    }
  }
});

// Every numeric interpolation, including existing chrome, must keep its
// signed number or complete numeric expression inside an LTR isolate.
const numericHebrew = {
  charCount: () => he.charCount(-12),
  charCountBoth: () => he.charCount(-12, 34, 56),
  charCountMin: () => he.charCount(-12, 34),
  charCountMax: () => he.charCount(-12, undefined, 56),
  timerRemaining: () => he.timerRemaining("0:42"),
  rangesSelected: () => he.rangesSelected(12),
  pointsMarked: () => he.pointsMarked(12),
  timelineTrackFallback: () => he.timelineTrackFallback(12),
  timelineNoAnnotationSelected: () => he.timelineNoAnnotationSelected(12),
  timelinePointSelected: () => he.timelinePointSelected(12, 34, -56.5),
  timelineRangeSelected: () => he.timelineRangeSelected(12, 34, -56.5, 78),
  mediaErrorCode: () => he.mediaErrorCode(12),
  mediaStepBack: () => he.mediaStepBack(12),
  mediaStepBackTitle: () => he.mediaStepBackTitle(12),
  mediaStepForward: () => he.mediaStepForward(12),
  mediaStepForwardTitle: () => he.mediaStepForwardTitle(12),
  numericGuidanceBoth: () => he.numericGuidance(false, "-12.5", "34"),
  numericGuidanceMin: () => he.numericGuidance(true, "-12"),
  numericGuidanceMax: () => he.numericGuidance(false, undefined, "34"),
  numericLessThan: () => he.numericLessThan("-12.5", "34"),
  numericMoreThan: () => he.numericMoreThan("34", "-12.5"),
};

for (const [name, format] of Object.entries(numericHebrew)) {
  test(`Hebrew ${name} isolates every interpolated numeric expression`, () => {
    const text = format();
    const numbers = [...text.matchAll(/-?\d+(?:\.\d+)?(?::\d+)?/g)];
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) {
      const at = number.index;
      expect(text.lastIndexOf("\u2066", at)).toBeGreaterThan(
        text.lastIndexOf("\u2069", at),
      );
      expect(text.indexOf("\u2069", at)).toBeGreaterThanOrEqual(
        at + number[0].length,
      );
    }
  });
}
