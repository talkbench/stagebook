import { describe, expect, test } from "vitest";
import {
  AWAY_LOG_CAP,
  awayReason,
  createAwayPause,
  loggedAwayPauses,
} from "./awayPause.js";

describe("awayReason", () => {
  const page = (hidden: boolean, focused: boolean) => ({ hidden, focused });

  test("no triggers never counts as away", () => {
    expect(awayReason([], page(true, false))).toBeNull();
  });

  test("hidden pauses only for a hidden page", () => {
    expect(awayReason(["hidden"], page(true, false))).toBe("hidden");
    expect(awayReason(["hidden"], page(false, false))).toBeNull();
    expect(awayReason(["hidden"], page(false, true))).toBeNull();
  });

  test("unfocused also covers a hidden page, reported as hidden", () => {
    expect(awayReason(["unfocused"], page(false, false))).toBe("unfocused");
    expect(awayReason(["unfocused"], page(true, false))).toBe("hidden");
    expect(awayReason(["unfocused"], page(false, true))).toBeNull();
  });
});

describe("createAwayPause", () => {
  const setup = (
    initial?: Parameters<typeof createAwayPause>[0]["initial"],
  ) => {
    let now = 0;
    const away = createAwayPause({ now: () => now, initial });
    return {
      away,
      tick: (ms: number) => {
        now += ms;
      },
    };
  };

  test("counts each automatic pause and the wall time it lasts", () => {
    const { away, tick } = setup();
    away.begin("hidden", 4, 10);
    expect(away.episode()).toMatchObject({
      reason: "hidden",
      videoTime: 4,
      stageTimeElapsed: 10,
      log: "pending",
    });
    tick(1500);
    expect(away.awayMs()).toBe(1500);
    expect(away.snapshot()).toMatchObject({
      awayPauseCount: 1,
      awayPausedSeconds: 1.5,
    });
    tick(500);
    away.end();
    tick(5000);
    expect(away.episode()).toBeNull();
    expect(away.snapshot()).toEqual({
      awayPauseCount: 1,
      awayPausedSeconds: 2,
      resumeBlockedCount: 0,
      awayPausesDropped: 0,
    });
  });

  test("a second begin while an episode is open is ignored", () => {
    const { away, tick } = setup();
    away.begin("unfocused", 4, 10);
    tick(100);
    away.begin("hidden", 5, 11);
    expect(away.episode()).toMatchObject({ reason: "unfocused" });
    expect(away.snapshot().awayPauseCount).toBe(1);
  });

  test("logs at most the cap, then counts the rest as dropped", () => {
    const { away } = setup();
    for (let i = 0; i < AWAY_LOG_CAP + 2; i++) {
      away.begin("hidden", 0, 0);
      expect(away.claimLog()).toBe(i < AWAY_LOG_CAP);
      expect(away.episode()?.log).toBe(i < AWAY_LOG_CAP ? "logged" : "silent");
      away.end();
    }
    expect(away.snapshot()).toMatchObject({
      awayPauseCount: AWAY_LOG_CAP + 2,
      awayPausesDropped: 2,
    });
  });

  test("a claimed or skipped episode cannot be claimed again", () => {
    const { away } = setup();
    away.begin("hidden", 0, 0);
    away.skipLog();
    expect(away.claimLog()).toBe(false);
    expect(away.episode()?.log).toBe("silent");
    expect(away.snapshot().awayPausesDropped).toBe(0);
  });

  test("continues restored totals and the restored log cap", () => {
    const { away } = setup({
      stats: {
        awayPauseCount: 3,
        awayPausedSeconds: 4,
        resumeBlockedCount: 1,
        awayPausesDropped: 0,
      },
      logged: AWAY_LOG_CAP,
    });
    away.begin("hidden", 0, 0);
    expect(away.claimLog()).toBe(false);
    away.blocked();
    expect(away.snapshot()).toEqual({
      awayPauseCount: 4,
      awayPausedSeconds: 4,
      resumeBlockedCount: 2,
      awayPausesDropped: 1,
    });
  });

  test("ignores invalid restored totals", () => {
    const { away } = setup({
      stats: {
        awayPauseCount: 1.5,
        awayPausedSeconds: -2,
        resumeBlockedCount: Number.NaN,
        awayPausesDropped: 2,
      },
    });
    expect(away.snapshot()).toEqual({
      awayPauseCount: 0,
      awayPausedSeconds: 0,
      resumeBlockedCount: 0,
      awayPausesDropped: 2,
    });
  });
});

test("loggedAwayPauses counts only automatic pause events", () => {
  expect(
    loggedAwayPauses([
      { type: "pause", videoTime: 1, stageTimeElapsed: 1 },
      { type: "pause", videoTime: 1, stageTimeElapsed: 1, reason: "hidden" },
      { type: "pause", videoTime: 1, stageTimeElapsed: 1, reason: "unfocused" },
      { type: "play", videoTime: 1, stageTimeElapsed: 1, reason: "return" },
    ]),
  ).toBe(2);
  expect(loggedAwayPauses(undefined)).toBe(0);
});
