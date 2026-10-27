import { invalidMappings } from "./testing/invalidMappings.js";
import { describe, expect, test } from "vitest";
import { checkChannelLayout, resolveChannelLayout } from "./channelLayout.js";

const mapping = [
  { index: 1, role: "participant", position: 5 },
  { index: 0, role: "participant", position: 0, label: "Speaker A" },
];
const probe = { verdict: "pass", mappings: { 2: [0, 1], 3: [0, 2, 1] } };

test("task validation needs no browser; breakout positions survive source and display ordering", () => {
  expect(checkChannelLayout({ mapping })).toEqual([]);
  expect(resolveChannelLayout(mapping, probe)).toEqual([
    { position: 0, label: "Speaker A", decodedChannel: 0 },
    { position: 5, decodedChannel: 1 },
  ]);
});

test("each recording uses its own count, inverts the decoded permutation, then sorts positions", () => {
  const three = [
    { index: 0, role: "participant", position: 5 },
    { index: 1, role: "participant", position: 0 },
    { index: 2, role: "participant", position: 3 },
  ];
  expect(resolveChannelLayout(three, probe)).toEqual([
    { position: 0, decodedChannel: 2 },
    { position: 3, decodedChannel: 1 },
    { position: 5, decodedChannel: 0 },
  ]);
  expect(resolveChannelLayout(mapping, probe)[1].decodedChannel).toBe(1);
});

describe("mapping refusal", () => {
  test.each(invalidMappings.map((value) => ({ value })))("%j", ({ value }) => {
    expect(checkChannelLayout({ mapping: value }).length).toBeGreaterThan(0);
    expect(() => resolveChannelLayout(value, probe)).toThrow();
  });
});

test.each(
  [
    undefined,
    null,
    {},
    { verdict: "fail", mappings: { 2: [0, 1] } },
    { verdict: "pass", mappings: { 3: [0, 2, 1] } },
    { verdict: "pass", mappings: { 2: null } },
    { verdict: "pass", mappings: { 2: [0, 0] } },
    { verdict: "pass", mappings: { 2: [1, 2] } },
    { verdict: "pass", mappings: { 2: [0] } },
    { verdict: "pass", mappings: { 2: [0, "1"] } },
  ].map((value) => ({ value })),
)("refuses unavailable or malformed calibration: %j", ({ value }) => {
  expect(() => resolveChannelLayout(mapping, value)).toThrow();
  expect(checkChannelLayout({ mapping, probe: value }).length).toBeGreaterThan(
    0,
  );
});

test("one participant needs no probe, including when the session probe failed", () => {
  const solo = [{ index: 0, role: "participant", position: 5 }];
  expect(resolveChannelLayout(solo)).toEqual([
    { position: 5, decodedChannel: 0 },
  ]);
  expect(
    checkChannelLayout({ mapping: solo, probe: { verdict: "fail" } }),
  ).toEqual([]);
});
