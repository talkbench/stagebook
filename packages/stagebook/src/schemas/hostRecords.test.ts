import { describe, expect, test } from "vitest";
import {
  attributesSchema,
  checkHostRecord,
  hostRecordSchemas,
  submitButtonRecordSchema,
  timelineRecordSchema,
  trackedLinkRecordSchema,
} from "../index.js";

const click = {
  type: "click",
  timestamp: 1_700_000_000_000,
  stage: "game_0_task",
  stageTimeSeconds: 12.5,
};
const linkRecord = {
  name: "signup",
  url: "https://example.org/form",
  displayText: "Open form",
  events: [click],
  totalTimeAwaySeconds: 0,
  lastEventType: "click",
  lastUpdated: click.timestamp,
};

describe("timelineRecordSchema", () => {
  test.each([
    { record: [] },
    { record: [{ start: 1.25, end: 2.5 }] },
    { record: [{ start: 2, end: 2, track: 0 }] },
    { record: [{ time: 1.25 }, { time: 2.5, track: 1 }] },
  ])("accepts saved selections: %j", ({ record }) => {
    expect(timelineRecordSchema.parse(record)).toEqual(record);
  });

  test.each(
    [
      {},
      { value: [{ time: 1 }] },
      [{ start: 1 }],
      [{ start: 1, end: 2 }, { time: 3 }],
      [{ time: "1" }],
      [{ time: Number.NaN }],
      [{ start: 1, end: Infinity }],
      [{ time: 1, track: "0" }],
    ].map((record) => ({ record })),
  )("rejects malformed selections: %j", ({ record }) => {
    expect(timelineRecordSchema.safeParse(record).success).toBe(false);
  });
});

describe("trackedLinkRecordSchema", () => {
  test("accepts click, blur, focus and optional Element metadata", () => {
    const record = {
      ...linkRecord,
      events: [
        click,
        { ...click, type: "blur" },
        { ...click, type: "focus", timeAwaySeconds: 8.25 },
      ],
      totalTimeAwaySeconds: 8.25,
      lastEventType: "focus",
      lastTimeAwaySeconds: 8.25,
      step: "game_0_task",
      stageTimeElapsed: 20.75,
      hostTag: "fixture",
    };
    expect(trackedLinkRecordSchema.parse(record)).toEqual(record);
  });

  test("accepts the writer's initial shape without derived last-event fields", () => {
    expect(
      trackedLinkRecordSchema.safeParse({
        name: "signup",
        url: "https://example.org/form",
        displayText: "Open form",
        events: [],
        totalTimeAwaySeconds: 0,
      }).success,
    ).toBe(true);
  });

  test.each([
    { ...linkRecord, events: undefined },
    { ...linkRecord, name: undefined },
    { ...linkRecord, events: [{ ...click, type: "submit" }] },
    { ...linkRecord, events: [{ ...click, timestamp: "1700000000000" }] },
    { ...linkRecord, events: [{ ...click, stageTimeSeconds: Infinity }] },
    { ...linkRecord, events: [{ ...click, timeAwaySeconds: "8" }] },
    { ...linkRecord, totalTimeAwaySeconds: "0" },
    { ...linkRecord, lastUpdated: Number.NaN },
    { ...linkRecord, stageTimeElapsed: "12.5" },
  ])("rejects malformed link records: %j", (record) => {
    expect(trackedLinkRecordSchema.safeParse(record).success).toBe(false);
  });
});

describe("submitButtonRecordSchema", () => {
  test.each([
    { time: 0 },
    { time: 25.5, step: "game_0_task", stageTimeElapsed: 25.5 },
    { time: 1, hostTag: "fixture" },
  ])("accepts submit records: %j", (record) => {
    expect(submitButtonRecordSchema.parse(record)).toEqual(record);
  });

  test.each([
    {},
    { time: "25.5" },
    { time: Number.NaN },
    { time: Infinity },
    { time: 1, step: 2 },
    { time: 1, stageTimeElapsed: Infinity },
  ])("rejects malformed or legacy records: %j", (record) => {
    expect(submitButtonRecordSchema.safeParse(record).success).toBe(false);
  });
});

describe("checkHostRecord", () => {
  test("exports a source map and reuses the attributes contract", () => {
    expect(Object.keys(hostRecordSchemas).sort()).toEqual([
      "attributes",
      "submitButton",
      "timeline",
      "trackedLink",
    ]);
    expect(hostRecordSchemas.attributes).toBe(attributesSchema);
    expect(checkHostRecord("attributes", {}).success).toBe(false);
    const attributes = { stableParticipantId: "stable-1", hostTag: true };
    expect(checkHostRecord("attributes", attributes)).toEqual({
      success: true,
      data: attributes,
    });
  });

  test.each([
    ["timeline", [{ time: 1 }]],
    ["trackedLink", linkRecord],
    ["submitButton", { time: 1 }],
  ])("checks %s without mutating the input", (source, record) => {
    const before = structuredClone(record);
    expect(checkHostRecord(source, record).success).toBe(true);
    expect(record).toEqual(before);
  });

  test("returns field paths for host CI failures", () => {
    const result = checkHostRecord("trackedLink", {
      ...linkRecord,
      events: [{ ...click, stageTimeSeconds: "12.5" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([
        "events",
        0,
        "stageTimeSeconds",
      ]);
    }
  });

  test.each([
    "prompt",
    "qualtrics",
    "mediaPlayer",
    "discussion",
    "entryUrl",
    "unknown",
    "toString",
    "constructor",
    "__proto__",
  ])("explicitly rejects unsupported source %s", (source) => {
    const result = checkHostRecord(source, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Unsupported");
    }
  });
});
