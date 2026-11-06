import { expect, test } from "vitest";
import { matchesPointerClick } from "./pointerEventMatching.js";

const touch = {
  pointerId: 0,
  pointerType: "touch",
  isTrusted: true,
  release: { timestamp: 1000, x: 60.75, y: 40.25, isTrusted: true },
};
const compatibilityClick = {
  pointerId: 1,
  pointerType: "mouse",
  isTrusted: true,
  clientX: 60,
  clientY: 40,
  detail: 1,
};

test("matches a trusted touch compatibility mouse click despite its different pointer ID", () => {
  expect(matchesPointerClick(touch, compatibilityClick, 1300)).toBe(true);
});

test.each([
  { ...touch, pointerType: "pen" },
  { ...touch, pointerType: "mouse" },
  { ...touch, isTrusted: false },
  { ...touch, release: null },
  { ...touch, release: { ...touch.release, isTrusted: false } },
])(
  "does not generalize touch compatibility to unmatched press/release evidence %#",
  (evidence) => {
    expect(matchesPointerClick(evidence, compatibilityClick, 1300)).toBe(false);
  },
);

test.each([
  { ...compatibilityClick, pointerType: "pen" },
  { ...compatibilityClick, pointerType: "" },
  { ...compatibilityClick, pointerId: -1 },
  { ...compatibilityClick, isTrusted: false },
  { ...compatibilityClick, detail: 0 },
  { ...compatibilityClick, clientX: 62 },
  { ...compatibilityClick, clientY: 42 },
])("rejects incompatible click metadata or placement %#", (click) => {
  expect(matchesPointerClick(touch, click, 1300)).toBe(false);
});

test("touch compatibility is limited to the second following release", () => {
  expect(matchesPointerClick(touch, compatibilityClick, 2000)).toBe(true);
  expect(matchesPointerClick(touch, compatibilityClick, 2001)).toBe(false);
  expect(matchesPointerClick(touch, compatibilityClick, 999)).toBe(false);
});

test("normal pointer ID matching and legacy mouse events retain their paths", () => {
  expect(
    matchesPointerClick(
      touch,
      { ...compatibilityClick, pointerId: 0, pointerType: "touch" },
      1000,
    ),
  ).toBe(true);
  const mouseEvent = { isTrusted: true, clientX: 60, clientY: 40, detail: 1 };
  expect(matchesPointerClick(touch, mouseEvent, 1000)).toBe(true);
  expect(matchesPointerClick(touch, { ...mouseEvent, detail: 0 }, 1000)).toBe(
    false,
  );
});
