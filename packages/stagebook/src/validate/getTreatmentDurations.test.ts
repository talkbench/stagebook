import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import {
  getTreatmentDurations,
  mergeTreatmentDurations,
  type TreatmentDurations,
} from "./getTreatmentDurations.js";
import { expandAndValidateWithImports } from "./expandAndValidate.js";

/**
 * `getTreatmentDurations` (#585) — the fourth host-facing analysis
 * primitive. It answers "how long can this treatment run?" as an UPPER
 * BOUND, so a host can size a runtime resource (the runner's Daily room
 * `exp`, talkbench/runner#542 §3) against the design instead of pinning
 * it to a guess.
 *
 * Two properties carry most of the risk and get the most tests here:
 * the report must never silently read zero from an un-hydrated tree (a
 * host would under-provision and lose the room mid-session), and it
 * must never let author-controlled content outside a real DSL position
 * inflate the bound.
 */

const ZERO: TreatmentDurations = {
  gameSeconds: 0,
  gameStages: 0,
  unresolvedStages: 0,
  consentSteps: 0,
  unresolvedConsentSteps: 0,
  introSteps: 0,
  unresolvedIntroSteps: 0,
  exitSteps: 0,
  unresolvedExitSteps: 0,
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

  test("an absent exitSequence is zero exit steps, not an unread one", () => {
    // `exitSequence` is the one optional list — absent genuinely means
    // no exit steps, so it must not raise the unresolved flag.
    const report = getTreatmentDurations({
      treatments: [{ name: "control", gameStages: [stage("a", 300)] }],
    });
    expect(report.byTreatment.control.exitSteps).toBe(0);
    expect(report.byTreatment.control.unresolvedExitSteps).toBe(0);
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
    expect(report.byTreatment.branching).toEqual({
      ...ZERO,
      gameSeconds: 900,
      gameStages: 2,
    });
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
      ...ZERO,
      gameSeconds: 3600,
      gameStages: 2,
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

  describe("un-hydrated input is flagged, never a silent zero", () => {
    // The failure that matters most: a host passes a merely
    // import-merged tree, gets a clean-looking zero, and provisions for
    // a study that actually runs an hour longer than the bound says.

    test("a whole-arm template invocation is flagged", () => {
      // `treatments: [{ template: … }]` is what a merely import-merged
      // tree carries — no `gameStages` key at all.
      const report = getTreatmentDurations({
        templates: [
          {
            name: "std",
            contentType: "treatment",
            content: { name: "t", gameStages: [stage("a", 3600)] },
          },
        ],
        treatments: [{ template: "std", fields: {} }],
      });
      // Both flags must fire. The expansion can add an `exitSequence`,
      // so the absent raw one is NOT the schema's optional-list case —
      // a host checking only the exit flag would otherwise trust
      // `exitSteps: 0`.
      expect(report.overall).toEqual({
        ...ZERO,
        gameStages: 1,
        unresolvedStages: 1,
        exitSteps: 1,
        unresolvedExitSteps: 1,
      });
    });

    test("a whole-list template invocation is flagged", () => {
      // `gameStages: { template: … }` — schema-valid via
      // altTemplateContext, and not an array.
      const report = getTreatmentDurations({
        treatments: [{ name: "t", gameStages: { template: "rounds" } }],
      });
      expect(report.byTreatment.t).toEqual({
        ...ZERO,
        gameStages: 1,
        unresolvedStages: 1,
      });
    });

    test("an un-hydrated step list is flagged on every phase", () => {
      const report = getTreatmentDurations({
        introSequences: [{ name: "i", introSteps: { template: "s" } }],
        consent: [{ name: "c", steps: "${consentSteps}" }],
        treatments: [
          {
            name: "t",
            gameStages: [stage("a", 60)],
            exitSequence: { template: "s" },
          },
        ],
      });
      expect(report.byIntroSequence.i).toEqual({
        ...ZERO,
        introSteps: 1,
        unresolvedIntroSteps: 1,
      });
      expect(report.byConsent.c).toEqual({
        ...ZERO,
        consentSteps: 1,
        unresolvedConsentSteps: 1,
      });
      expect(report.byTreatment.t).toEqual({
        ...ZERO,
        gameSeconds: 60,
        gameStages: 1,
        exitSteps: 1,
        unresolvedExitSteps: 1,
      });
    });

    test("a whole-COLLECTION template invocation is flagged", () => {
      // `treatmentsSchema` / `introSequencesSchema` / `consentSchema` are
      // each `altTemplateContext`-wrapped, so the collection itself can
      // be an invocation — present, schema-valid, and not an array.
      const report = getTreatmentDurations({
        treatments: { template: "all_arms" },
        introSequences: { template: "all_intros" },
        consent: { template: "all_consents" },
      });
      // Every phase flags independently — a shared counter would have
      // collapsed these three into one.
      expect(report.overall.unresolvedStages).toBe(1);
      expect(report.overall.unresolvedConsentSteps).toBe(1);
      expect(report.overall.unresolvedIntroSteps).toBe(1);
      expect(report.overall.unresolvedExitSteps).toBe(1);
      expect(report.byTreatment).toEqual({});
      expect(report.byIntroSequence).toEqual({});
      expect(report.byConsent).toEqual({});
      // …and the maps being empty is itself reported, so a host that
      // narrows by name can tell "no arms" from "arms I couldn't read".
      expect(report.unnamedArms).toBe(3);
    });

    test("a step position that is a template invocation is flagged", () => {
      // A list-valued template (`contentType: exitSteps`) or a
      // `broadcast:` fans one position out into several, so counting it
      // as a single resolved step would under-count in silence.
      const report = getTreatmentDurations({
        introSequences: [
          {
            name: "i",
            introSteps: [step("real"), { template: "checks", fields: {} }],
          },
        ],
        treatments: [
          {
            name: "t",
            gameStages: [stage("a", 60)],
            exitSequence: [
              { template: "debrief", broadcast: { n: [1, 2, 3] } },
            ],
          },
        ],
      });
      expect(report.byIntroSequence.i).toEqual({
        ...ZERO,
        introSteps: 2,
        unresolvedIntroSteps: 1,
      });
      expect(report.byTreatment.t).toEqual({
        ...ZERO,
        gameSeconds: 60,
        gameStages: 1,
        exitSteps: 1,
        unresolvedExitSteps: 1,
      });
    });

    test("a stage position that is a template invocation is flagged", () => {
      // Already covered by having no numeric `duration`, but pin it —
      // it's the same un-hydrated shape as the step case above.
      const report = getTreatmentDurations({
        treatments: [
          { name: "t", gameStages: [{ template: "round", fields: {} }] },
        ],
      });
      expect(report.byTreatment.t).toEqual({
        ...ZERO,
        gameStages: 1,
        unresolvedStages: 1,
      });
    });

    test("an arm entry that isn't a record is flagged, not dropped", () => {
      // A YAML indentation slip nests a whole treatment one level deep.
      const report = getTreatmentDurations({
        treatments: [[{ name: "t", gameStages: [stage("a", 900)] }]],
      });
      expect(report.overall.unresolvedStages).toBe(1);
      expect(report.byTreatment).toEqual({});
    });

    test("a non-record step position is flagged", () => {
      const report = getTreatmentDurations({
        treatments: [
          {
            name: "t",
            gameStages: [stage("a", 60)],
            exitSequence: [step("ok"), null, "junk"],
          },
        ],
      });
      expect(report.byTreatment.t).toEqual({
        ...ZERO,
        gameSeconds: 60,
        gameStages: 1,
        exitSteps: 3,
        unresolvedExitSteps: 2,
      });
    });
  });

  describe("unnamedArms guards the narrowed-merge path", () => {
    test("is zero for a hydrated file where every arm is named", () => {
      const report = getTreatmentDurations({
        consent: [{ name: "irb", steps: [step("form")] }],
        introSequences: [{ name: "en", introSteps: [step("a")] }],
        treatments: [{ name: "control", gameStages: [stage("a", 600)] }],
      });
      expect(report.unnamedArms).toBe(0);
    });

    test("counts every entry the keyed maps drop", () => {
      const report = getTreatmentDurations({
        treatments: [
          { name: "real", gameStages: [stage("a", 600)] },
          { gameStages: [stage("a", 900)] }, // unnamed
          { template: "std" }, // invocation — carries no name
          [{ name: "nested", gameStages: [stage("a", 60)] }], // not a record
        ],
      });
      expect(Object.keys(report.byTreatment)).toEqual(["real"]);
      expect(report.unnamedArms).toBe(3);
    });

    test("it is the only signal a narrowing host gets for an unreadable arm", () => {
      // The hazard: `overall` is correctly flagged, but a host that
      // narrows by name looks up a key that was never added, and
      // mergeTreatmentDurations skips `undefined` — so the narrowed
      // bound comes back all-zero AND all-clear.
      const report = getTreatmentDurations({
        treatments: { template: "all_arms" },
      });
      expect(report.overall.unresolvedStages).toBe(1);

      const narrowed = mergeTreatmentDurations(report.byTreatment.control);
      expect(narrowed).toEqual(ZERO);
      expect(narrowed.unresolvedStages).toBe(0);

      // Nothing inside the merged value can reveal the problem, so the
      // host has to consult the report itself.
      expect(report.unnamedArms).toBeGreaterThan(0);
    });
  });

  test("author content outside a real DSL position never inflates the bound", () => {
    // `discussion.layout.feeds[].options` is an open
    // `z.record(z.string(), z.unknown())` bag sitting inside a GAME
    // STAGE, so an author can put a key named `steps` / `introSteps` /
    // `gameStages` in it. Reading fixed arm positions instead of hunting
    // key names is what makes this structurally impossible.
    const report = getTreatmentDurations({
      consent: [{ name: "irb", steps: [step("form")] }],
      treatments: [
        {
          name: "control",
          gameStages: [
            {
              ...stage("s", 600),
              discussion: {
                chatType: "video",
                layout: {
                  feeds: [
                    {
                      source: { type: "self" },
                      displayRegion: "main",
                      options: {
                        steps: [{ at: 0 }, { at: 1 }, { at: 2 }, { at: 3 }],
                        introSteps: [{ at: 0 }],
                        gameStages: [{ name: "fake", duration: 99999 }],
                        // A prototype-chain key, which a `key in table`
                        // lookup would have matched.
                        constructor: [{ at: 0 }],
                      },
                    },
                  ],
                },
              },
            },
          ],
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
      gameSeconds: 600,
      gameStages: 1,
      exitSteps: 1,
    });
    expect(report.byConsent.irb.consentSteps).toBe(1);
    expect(report.overall.consentSteps).toBe(1);
  });

  test("gameSeconds stays finite and JSON-safe under an enormous sum", () => {
    // `durationSchema` is `z.number().int().positive()` with no upper
    // bound, and `Number.isInteger(1e308)` is true — so this file is
    // schema-valid. An `Infinity` here would reach a host as `null`
    // through JSON, and `now + Infinity` is a nonsense room expiry.
    const report = getTreatmentDurations({
      treatments: [
        {
          name: "overflow",
          gameStages: [stage("a", 1e308), stage("b", 1e308)],
        },
      ],
    });
    const { gameSeconds, unresolvedStages } = report.byTreatment.overflow;
    expect(Number.isFinite(gameSeconds)).toBe(true);
    expect(gameSeconds).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(JSON.parse(JSON.stringify({ gameSeconds })).gameSeconds).toBe(
      gameSeconds,
    );
    expect(unresolvedStages).toBeGreaterThan(0);
  });

  test("a repeated object reference (a YAML alias) counts once per position", () => {
    // js-yaml resolves an alias to the SAME object, so one stage object
    // can occupy two positions. Each position is a real stage the
    // participant runs, so both must count — this pins the sum against a
    // refactor that dedupes by object identity.
    const shared = stage("round", 600);
    const sharedStep = step("wrap");
    const report = getTreatmentDurations({
      treatments: [
        {
          name: "aliased",
          gameStages: [shared, shared],
          exitSequence: [sharedStep, sharedStep],
        },
      ],
    });
    expect(report.byTreatment.aliased).toEqual({
      ...ZERO,
      gameSeconds: 1200,
      gameStages: 2,
      exitSteps: 2,
    });
  });

  describe("keyed maps", () => {
    test("a hostile arm name stays an ordinary enumerable key", () => {
      const report = getTreatmentDurations({
        treatments: [{ name: "__proto__", gameStages: [stage("a", 300)] }],
      });
      expect(Object.keys(report.byTreatment)).toEqual(["__proto__"]);
      expect(report.byTreatment["__proto__"].gameSeconds).toBe(300);
      expect(({} as Record<string, unknown>).gameSeconds).toBeUndefined();
    });

    test("an unset key reads undefined, not an inherited member", () => {
      // The null prototype is load-bearing: with a plain `{}`,
      // `byTreatment["constructor"]` would be a function, which
      // mergeTreatmentDurations (guarding only on `!== undefined`) would
      // fold into `Math.max(0, undefined)` — NaN in every field, and a
      // NaN room expiry for the host.
      const report = getTreatmentDurations({
        treatments: [{ name: "real", gameStages: [stage("a", 300)] }],
      });
      expect(Object.getPrototypeOf(report.byTreatment)).toBeNull();
      for (const key of ["constructor", "toString", "hasOwnProperty"]) {
        expect(report.byTreatment[key]).toBeUndefined();
        expect(mergeTreatmentDurations(report.byTreatment[key])).toEqual(ZERO);
      }
    });

    test("duplicate arm names fold field-wise, not last-write-wins", () => {
      // Crossing fixture: neither arm dominates on every field, so this
      // fails for any "pick the longer arm wholesale" implementation.
      const report = getTreatmentDurations({
        treatments: [
          { name: "dup", gameStages: [stage("a", 900)] },
          {
            name: "dup",
            gameStages: [stage("a", 300)],
            exitSequence: [step("x"), step("y")],
          },
        ],
      });
      expect(report.byTreatment.dup).toEqual({
        ...ZERO,
        gameSeconds: 900,
        gameStages: 1,
        exitSteps: 2,
      });
    });
  });

  test("malformed arm collections degrade rather than throwing", () => {
    const report = getTreatmentDurations({
      treatments: "not-an-array",
      introSequences: [null, 7, { name: 5, introSteps: [step("a")] }],
      consent: [{ name: "c", steps: "not-an-array" }],
    });
    // A present-but-non-array collection supplies no selectable arm, but
    // it is not "no arms" either — it scans as one unread arm.
    expect(report.byTreatment).toEqual({});
    expect(report.overall.unresolvedStages).toBe(1);
    // Entries that can't supply a name are dropped from the keyed map
    // but still fold into `overall` — the over-estimating direction.
    expect(report.byIntroSequence).toEqual({});
    expect(report.overall.introSteps).toBe(1);
    expect(report.byConsent.c).toEqual({
      ...ZERO,
      consentSteps: 1,
      unresolvedConsentSteps: 1,
    });
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

  test("an unresolved flag in any selected arm survives the merge", () => {
    expect(
      mergeTreatmentDurations(
        { ...ZERO, gameSeconds: 900, gameStages: 1 },
        { ...ZERO, gameStages: 1, unresolvedStages: 1 },
        { ...ZERO, introSteps: 1, unresolvedIntroSteps: 1 },
      ),
    ).toEqual({
      ...ZERO,
      gameSeconds: 900,
      gameStages: 1,
      unresolvedStages: 1,
      introSteps: 1,
      unresolvedIntroSteps: 1,
    });
  });

  test("sequential phases each keep their own unresolved count", () => {
    // Consent, intro and exit run IN SERIES for one participant, so a
    // single shared `unresolvedSteps` counter would max these three
    // 1s down to 1 and under-report how much is unread. Each phase
    // having its own field is what keeps the field-wise max exact.
    expect(
      mergeTreatmentDurations(
        { ...ZERO, consentSteps: 2, unresolvedConsentSteps: 1 },
        { ...ZERO, introSteps: 3, unresolvedIntroSteps: 1 },
        { ...ZERO, exitSteps: 4, unresolvedExitSteps: 1 },
      ),
    ).toEqual({
      ...ZERO,
      consentSteps: 2,
      unresolvedConsentSteps: 1,
      introSteps: 3,
      unresolvedIntroSteps: 1,
      exitSteps: 4,
      unresolvedExitSteps: 1,
    });
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
      ...ZERO,
      gameSeconds: 1800,
      gameStages: 2,
      consentSteps: 1,
      introSteps: 2,
      exitSteps: 1,
    });

    // The runner's use: size the call room to the game, plus slack, with
    // the current hour as a floor so nothing regresses.
    expect(selected.unresolvedStages).toBe(0);
    const roomLifetime = Math.max(3600, selected.gameSeconds + 600);
    expect(roomLifetime).toBe(3600);
  });
});

describe("over real hydrated example studies", () => {
  // The rest of the suite builds trees by hand, which can't catch a
  // mismatch between what fillTemplates EMITS and what this reads.
  // prisoners-dilemma is the sharpest case in the repo: a
  // `contentType: stages` template whose content is itself an array,
  // invoked bare in one arm and with `broadcast:` in another.
  const examplesRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../examples",
  );

  const hydrate = async (relPath: string) => {
    const fullPath = resolve(examplesRoot, relPath);
    const rootDir = dirname(fullPath);
    const result = await expandAndValidateWithImports({
      source: readFileSync(fullPath, "utf8"),
      loadImport: async (importPath) =>
        readFileSync(resolve(rootDir, importPath), "utf8"),
    });
    expect(result.expandError).toBeNull();
    return loadYaml(result.fullYaml);
  };

  test("prisoners-dilemma: a broadcast template expands into counted stages", async () => {
    const report = getTreatmentDurations(
      await hydrate("prisoners-dilemma/prisoners-dilemma.stagebook.yaml"),
    );

    expect(report.byTreatment["Prisoners Dilemma one-shot"]).toEqual({
      ...ZERO,
      gameSeconds: 90,
      gameStages: 2,
      exitSteps: 1,
    });
    // The same template, broadcast over three rounds.
    expect(report.byTreatment["Prisoners Dilemma 3-round repeated"]).toEqual({
      ...ZERO,
      gameSeconds: 270,
      gameStages: 6,
      exitSteps: 1,
    });
    expect(report.byIntroSequence.orientation.introSteps).toBe(1);
    // Max over the arms, not the 360 sum.
    expect(report.overall.gameSeconds).toBe(270);
    expect(report.overall.unresolvedStages).toBe(0);
    expect(report.unnamedArms).toBe(0);
    expect(report.overall.unresolvedConsentSteps).toBe(0);
    expect(report.overall.unresolvedIntroSteps).toBe(0);
    expect(report.overall.unresolvedExitSteps).toBe(0);
  });

  test("component-gallery: a real study already outlives a one-hour room", async () => {
    // The hazard #585 exists to surface is reachable with a file in this
    // repo — the runner's hard-coded 3600s `exp` would expire mid-game.
    const report = getTreatmentDurations(
      await hydrate("component-gallery/component-gallery.stagebook.yaml"),
    );
    expect(report.overall.gameSeconds).toBeGreaterThan(3600);
    expect(report.overall.unresolvedStages).toBe(0);
  });
});
