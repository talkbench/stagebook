import { describe, expect, test } from "vitest";
import {
  getTreatmentDurations,
  mergeTreatmentDurations,
  type TreatmentDurations,
} from "./getTreatmentDurations.js";

/**
 * `getTreatmentDurations` (#585) — the fourth host-facing analysis
 * primitive. It answers "how long can this treatment run?" as an UPPER
 * BOUND, so a host can size a runtime resource (the runner's Daily room
 * `exp`, talkbench/runner#542 §3) against the design instead of pinning
 * it to a guess.
 */

const ZERO: TreatmentDurations = {
  gameSeconds: 0,
  gameStages: 0,
  unresolvedStages: 0,
  consentSteps: 0,
  introSteps: 0,
  exitSteps: 0,
};

/** A minimal game stage. */
const stage = (name: string, duration: unknown) => ({
  name,
  duration,
  elements: [{ type: "submitButton" }],
});

/** A minimal intro/exit/consent step (no duration — self-paced). */
const step = (name: string) => ({
  name,
  elements: [{ type: "submitButton" }],
});

describe("getTreatmentDurations", () => {
  test("a non-object input yields a zero report and empty maps", () => {
    for (const input of [undefined, null, 42, "yaml", [1, 2, 3]]) {
      const report = getTreatmentDurations(input);
      expect(report.overall).toEqual(ZERO);
      expect(report.byTreatment).toEqual({});
      expect(report.byIntroSequence).toEqual({});
      expect(report.byConsent).toEqual({});
    }
  });

  test("an empty file yields a zero report", () => {
    const report = getTreatmentDurations({});
    expect(report.overall).toEqual(ZERO);
  });

  test("sums a treatment's game-stage durations", () => {
    const report = getTreatmentDurations({
      treatments: [
        {
          name: "control",
          gameStages: [stage("a", 300), stage("b", 600), stage("c", 120)],
        },
      ],
    });
    expect(report.byTreatment.control).toEqual({
      ...ZERO,
      gameSeconds: 1020,
      gameStages: 3,
    });
  });

  test("counts a treatment's exit steps without adding to gameSeconds", () => {
    const report = getTreatmentDurations({
      treatments: [
        {
          name: "control",
          gameStages: [stage("a", 300)],
          exitSequence: [step("debrief"), step("code")],
        },
      ],
    });
    expect(report.byTreatment.control).toEqual({
      ...ZERO,
      gameSeconds: 300,
      gameStages: 1,
      exitSteps: 2,
    });
  });

  test("counts intro steps under byIntroSequence only", () => {
    const report = getTreatmentDurations({
      introSequences: [
        { name: "prolific_en", introSteps: [step("consent"), step("checks")] },
      ],
    });
    expect(report.byIntroSequence.prolific_en).toEqual({
      ...ZERO,
      introSteps: 2,
    });
    expect(report.byTreatment).toEqual({});
  });

  test("counts consent steps under byConsent only", () => {
    const report = getTreatmentDurations({
      consent: [{ name: "irb_2026", steps: [step("form"), step("sign")] }],
    });
    expect(report.byConsent.irb_2026).toEqual({ ...ZERO, consentSteps: 2 });
    expect(report.byIntroSequence).toEqual({});
  });

  test("a `${field}` placeholder duration counts as unresolved and adds 0", () => {
    const report = getTreatmentDurations({
      treatments: [
        {
          name: "templated",
          gameStages: [stage("a", 300), stage("b", "${stageLength}")],
        },
      ],
    });
    expect(report.byTreatment.templated).toEqual({
      ...ZERO,
      gameSeconds: 300,
      gameStages: 2,
      unresolvedStages: 1,
    });
  });

  test("a missing, negative, or non-finite duration counts as unresolved", () => {
    const report = getTreatmentDurations({
      treatments: [
        {
          name: "junk",
          gameStages: [
            { name: "no-duration", elements: [] },
            stage("negative", -60),
            stage("zero", 0),
            stage("nan", Number.NaN),
            stage("infinite", Number.POSITIVE_INFINITY),
            stage("ok", 60),
          ],
        },
      ],
    });
    expect(report.byTreatment.junk).toEqual({
      ...ZERO,
      gameSeconds: 60,
      gameStages: 6,
      unresolvedStages: 5,
    });
  });

  test("a conditional stage still counts toward the maximum", () => {
    // Stages with `conditions:` can be skipped at runtime, but a
    // provisioning bound must assume they run.
    const report = getTreatmentDurations({
      treatments: [
        {
          name: "branching",
          gameStages: [
            stage("always", 300),
            { ...stage("maybe", 600), conditions: [{ reference: "x" }] },
          ],
        },
      ],
    });
    expect(report.byTreatment.branching.gameSeconds).toBe(900);
  });

  test("overall is the MAX across arms, never their sum", () => {
    const report = getTreatmentDurations({
      introSequences: [
        { name: "short", introSteps: [step("a")] },
        { name: "long", introSteps: [step("a"), step("b"), step("c")] },
      ],
      consent: [{ name: "irb", steps: [step("form")] }],
      treatments: [
        { name: "brief", gameStages: [stage("a", 300)] },
        {
          name: "extended",
          gameStages: [stage("a", 1800), stage("b", 1800)],
          exitSequence: [step("debrief")],
        },
      ],
    });
    // A participant runs ONE treatment, so the file's worst case is the
    // longest arm — not 300 + 3600.
    expect(report.overall).toEqual({
      gameSeconds: 3600,
      gameStages: 2,
      unresolvedStages: 0,
      consentSteps: 1,
      introSteps: 3,
      exitSteps: 1,
    });
  });

  test("overall covers unnamed arms, which the keyed maps drop", () => {
    const report = getTreatmentDurations({
      treatments: [{ gameStages: [stage("a", 900)] }],
    });
    expect(report.overall.gameSeconds).toBe(900);
    expect(report.byTreatment).toEqual({});
  });

  test("template definitions do not contribute", () => {
    // A merely import-merged tree still carries `templates:`; a template
    // that is never invoked describes no launchable session.
    const report = getTreatmentDurations({
      templates: [
        {
          name: "long_treatment",
          contentType: "treatment",
          content: { name: "t", gameStages: [stage("a", 99999)] },
        },
      ],
      treatments: [{ name: "real", gameStages: [stage("a", 300)] }],
    });
    expect(report.overall.gameSeconds).toBe(300);
    expect(report.byTreatment).toEqual({
      real: { ...ZERO, gameSeconds: 300, gameStages: 1 },
    });
  });

  test("a `duration` outside a gameStages position is never counted", () => {
    // Position-scoped, like getRequiredServices: only an item of a
    // `gameStages:` array is a stage. An opaque config bag that happens
    // to carry `duration` is not.
    const report = getTreatmentDurations({
      treatments: [
        {
          name: "control",
          gameStages: [stage("a", 300)],
          exitSequence: [
            {
              name: "wrap",
              duration: 9999,
              elements: [
                { type: "mediaPlayer", file: "v.mp4", stepDuration: 5 },
                { type: "timer", endTime: 8888 },
              ],
            },
          ],
        },
      ],
    });
    expect(report.byTreatment.control).toEqual({
      ...ZERO,
      gameSeconds: 300,
      gameStages: 1,
      exitSteps: 1,
    });
  });

  test("survives a cyclic object graph (YAML anchors/aliases)", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = [cyclic];
    const report = getTreatmentDurations({
      treatments: [
        { name: "control", gameStages: [stage("a", 300)], notes: cyclic },
      ],
    });
    expect(report.byTreatment.control.gameSeconds).toBe(300);
  });

  test("a hostile arm name stays an ordinary enumerable key", () => {
    const report = getTreatmentDurations({
      treatments: [{ name: "__proto__", gameStages: [stage("a", 300)] }],
    });
    expect(Object.keys(report.byTreatment)).toEqual(["__proto__"]);
    expect(report.byTreatment["__proto__"].gameSeconds).toBe(300);
    expect(({} as Record<string, unknown>).gameSeconds).toBeUndefined();
  });

  test("duplicate arm names fold to the longer arm", () => {
    const report = getTreatmentDurations({
      treatments: [
        { name: "dup", gameStages: [stage("a", 300)] },
        { name: "dup", gameStages: [stage("a", 900), stage("b", 60)] },
      ],
    });
    expect(report.byTreatment.dup).toEqual({
      ...ZERO,
      gameSeconds: 960,
      gameStages: 2,
    });
  });

  test("malformed arm collections degrade to zeros rather than throwing", () => {
    const report = getTreatmentDurations({
      treatments: "not-an-array",
      introSequences: [null, 7, { name: 5, introSteps: [step("a")] }],
      consent: [{ name: "c", steps: "not-an-array" }],
    });
    // The non-string-named intro sequence is dropped from the keyed map
    // but still folds into `overall` — the over-estimating direction.
    expect(report.overall).toEqual({ ...ZERO, introSteps: 1 });
    expect(report.byTreatment).toEqual({});
    expect(report.byIntroSequence).toEqual({});
    expect(report.byConsent).toEqual({ c: ZERO });
  });

  test("reaches stages nested below the arm root", () => {
    // The walk recurses through every value, so a stage list that sits
    // under an unexpected wrapper key is still found.
    const report = getTreatmentDurations({
      treatments: [
        { name: "wrapped", extra: { gameStages: [stage("a", 300)] } },
      ],
    });
    expect(report.byTreatment.wrapped.gameSeconds).toBe(300);
  });
});

describe("mergeTreatmentDurations", () => {
  test("with no arguments returns zeros", () => {
    expect(mergeTreatmentDurations()).toEqual(ZERO);
  });

  test("skips undefined entries (an unknown arm key)", () => {
    const a: TreatmentDurations = { ...ZERO, gameSeconds: 300, gameStages: 1 };
    expect(mergeTreatmentDurations(a, undefined)).toEqual(a);
    expect(mergeTreatmentDurations(undefined, undefined)).toEqual(ZERO);
  });

  test("takes the field-wise maximum", () => {
    expect(
      mergeTreatmentDurations(
        { ...ZERO, gameSeconds: 300, gameStages: 1, exitSteps: 3 },
        { ...ZERO, gameSeconds: 900, gameStages: 4, exitSteps: 1 },
      ),
    ).toEqual({ ...ZERO, gameSeconds: 900, gameStages: 4, exitSteps: 3 });
  });

  test("the consumer launch-selection pattern", () => {
    const report = getTreatmentDurations({
      consent: [{ name: "irb", steps: [step("form")] }],
      introSequences: [
        { name: "en", introSteps: [step("a"), step("b")] },
        { name: "he", introSteps: [step("a"), step("b"), step("c")] },
      ],
      treatments: [
        { name: "control", gameStages: [stage("a", 600)] },
        {
          name: "treated",
          gameStages: [stage("a", 600), stage("b", 1200)],
          exitSequence: [step("debrief")],
        },
        { name: "unused", gameStages: [stage("a", 99999)] },
      ],
    });

    // A batch launches (treatment set) × (one intro sequence) × (one
    // consent arm). Because the phases are separate fields, the field-wise
    // max is the worst case ONE participant can run.
    const selected = mergeTreatmentDurations(
      ...["control", "treated"].map((t) => report.byTreatment[t]),
      report.byIntroSequence.en,
      report.byConsent.irb,
    );
    expect(selected).toEqual({
      gameSeconds: 1800,
      gameStages: 2,
      unresolvedStages: 0,
      consentSteps: 1,
      introSteps: 2,
      exitSteps: 1,
    });

    // The runner's use: size the call room to the game, plus slack, with
    // the current hour as a floor so nothing regresses.
    const roomLifetime = Math.max(3600, selected.gameSeconds + 600);
    expect(roomLifetime).toBe(3600);
  });
});
