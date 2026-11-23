// Authoring and record contracts for pausing media while the participant is
// away (#844).
import { expect, test } from "vitest";
import { elementSchema } from "./treatment.js";
import { resolvedElementSchema } from "./resolved.js";
import { mediaPlayerRecordSchema } from "./mediaPlayerRecord.js";

const player = (fields: Record<string, unknown>) => ({
  type: "mediaPlayer",
  file: "clip.mp4",
  ...fields,
});
const messages = (fields: Record<string, unknown>) => {
  const result = elementSchema.safeParse(player(fields));
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

test.each([
  [{ pauseWhen: ["hidden"] }],
  [{ pauseWhen: ["unfocused"] }],
  [{ pauseWhen: ["hidden", "unfocused"], resumeOnReturn: false }],
  [{ pauseWhen: ["hidden"], rewindOnResume: 2, playback: "once" }],
  [{ pauseWhen: ["hidden"], rewindOnResume: 0 }],
])("accepts %j", (fields) => {
  expect(messages(fields)).toEqual([]);
});

test.each([
  [{ pauseWhen: [] }],
  [{ pauseWhen: ["minimized"] }],
  [{ pauseWhen: "hidden" }],
  [{ pauseWhen: ["hidden"], rewindOnResume: -1 }],
  [{ pauseWhen: ["hidden"], rewindOnResume: "${rewind}" }],
])("rejects %j", (fields) => {
  expect(messages(fields).length).toBeGreaterThan(0);
});

test("pauseWhen cannot be combined with syncToStageTime", () => {
  expect(messages({ pauseWhen: ["hidden"], syncToStageTime: true })).toEqual([
    expect.stringContaining("syncToStageTime"),
  ]);
});

test.each(["resumeOnReturn", "rewindOnResume"])(
  "%s requires pauseWhen",
  (field) => {
    const value = field === "resumeOnReturn" ? true : 2;
    expect(messages({ [field]: value })).toEqual([
      expect.stringContaining("pauseWhen"),
    ]);
  },
);

test("the resolved participant projection keeps the settings", () => {
  const result = resolvedElementSchema.safeParse(
    player({
      pauseWhen: ["unfocused"],
      resumeOnReturn: false,
      rewindOnResume: 3,
    }),
  );
  expect(result.success).toBe(true);
  expect(result.data).toMatchObject({
    pauseWhen: ["unfocused"],
    resumeOnReturn: false,
    rewindOnResume: 3,
  });
});

const base = { videoTime: 4, stageTimeElapsed: 10 };
const record = (events: unknown[], extra: Record<string, unknown> = {}) =>
  mediaPlayerRecordSchema.safeParse({
    name: "clip",
    url: "clip.mp4",
    events,
    lastVideoTime: 4,
    watchedRanges: [],
    ...extra,
  });

test("records carry automatic-pause reasons and counters", () => {
  const result = record(
    [
      { ...base, type: "pause", reason: "hidden" },
      { ...base, type: "pause", reason: "unfocused" },
      { ...base, type: "seek", fromTime: 4, videoTime: 2, reason: "return" },
      { ...base, type: "play", reason: "return" },
    ],
    {
      awayPauseCount: 3,
      awayPausedSeconds: 7.5,
      resumeBlockedCount: 1,
      awayPausesDropped: 0,
    },
  );
  expect(result.success).toBe(true);
});

test.each([
  [{ ...base, type: "pause", reason: "return" }],
  [{ ...base, type: "play", reason: "hidden" }],
  [{ ...base, type: "seek", fromTime: 4, reason: "hidden" }],
])("rejects a reason that does not fit its event: %j", (event) => {
  expect(record([event]).success).toBe(false);
});

test.each([
  ["awayPauseCount", 1.5],
  ["awayPausedSeconds", -1],
  ["resumeBlockedCount", -1],
  ["awayPausesDropped", 0.5],
])("rejects an invalid %s", (field, value) => {
  expect(record([], { [field]: value }).success).toBe(false);
});
