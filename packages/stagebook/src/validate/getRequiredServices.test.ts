import { describe, expect, test, vi } from "vitest";
import {
  getRequiredServices,
  mergeRequiredServices,
} from "./getRequiredServices.js";

/**
 * Host primitive (#508): walk an expanded treatment, tell the host which
 * external services it must provision — keyed by arm (`overall`,
 * `byTreatment`, `byIntroSequence`). Mirrors the injection shape of
 * `loadAndMergeImports` — the host supplies a `loadPrompt` loader so the
 * coedit signal (split between the treatment YAML's `shared: true` and
 * the prompt file's `type: openResponse`) can be resolved.
 */

function promptFile(type: string): string {
  if (type === "noResponse") {
    return `---\ntype: noResponse\n---\nBody.`;
  }
  if (type === "openResponse") {
    return `---\ntype: openResponse\n---\nBody.\n---\n> placeholder`;
  }
  return `---\ntype: ${type}\n---\nBody.\n---\n- one\n- two`;
}

/** A loader backed by a path→source map; fails loudly on a miss so a
 *  test that expects a file to be read can't silently pass. */
function loaderFrom(files: Record<string, string>) {
  return vi.fn(async (path: string) => {
    if (!(path in files)) throw new Error(`no such prompt file: ${path}`);
    return files[path];
  });
}

const NONE = {
  coedit: false,
  video: false,
  textChat: false,
  externalSurvey: false,
};

describe("getRequiredServices", () => {
  test("empty / non-object input requires nothing", async () => {
    const load = loaderFrom({});
    for (const input of [{}, null, "nope"]) {
      expect(await getRequiredServices(input, { loadPrompt: load })).toEqual({
        overall: NONE,
        byTreatment: {},
        byIntroSequence: {},
        byConsent: {},
      });
    }
    expect(load).not.toHaveBeenCalled();
  });

  test("shared openResponse prompt → coedit", async () => {
    const file = {
      treatments: [
        {
          name: "t",
          gameStages: [
            {
              name: "s",
              elements: [
                { type: "prompt", file: "notes.prompt.md", shared: true },
              ],
            },
          ],
        },
      ],
    };
    const load = loaderFrom({ "notes.prompt.md": promptFile("openResponse") });
    const report = await getRequiredServices(file, { loadPrompt: load });
    expect(report.overall.coedit).toBe(true);
    expect(report.byTreatment.t.coedit).toBe(true);
    expect(load).toHaveBeenCalledWith("notes.prompt.md");
  });

  test("shared prompt that is NOT openResponse → no coedit", async () => {
    const file = {
      treatments: [
        {
          gameStages: [
            {
              elements: [
                { type: "prompt", file: "quiz.prompt.md", shared: true },
              ],
            },
          ],
        },
      ],
    };
    const load = loaderFrom({ "quiz.prompt.md": promptFile("multipleChoice") });
    const report = await getRequiredServices(file, { loadPrompt: load });
    expect(report.overall.coedit).toBe(false);
  });

  test("unshared openResponse prompt → no coedit and no load", async () => {
    const file = {
      treatments: [
        {
          gameStages: [
            { elements: [{ type: "prompt", file: "notes.prompt.md" }] },
          ],
        },
      ],
    };
    const load = loaderFrom({ "notes.prompt.md": promptFile("openResponse") });
    const report = await getRequiredServices(file, { loadPrompt: load });
    expect(report.overall.coedit).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  test("a shared prompt referenced twice is loaded once", async () => {
    const file = {
      treatments: [
        {
          gameStages: [
            {
              elements: [
                { type: "prompt", file: "notes.prompt.md", shared: true },
              ],
            },
            {
              elements: [
                { type: "prompt", file: "notes.prompt.md", shared: true },
              ],
            },
          ],
        },
      ],
    };
    const load = loaderFrom({ "notes.prompt.md": promptFile("openResponse") });
    const report = await getRequiredServices(file, { loadPrompt: load });
    expect(report.overall.coedit).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("the same shared prompt across two treatments is loaded once", async () => {
    const t = (name: string) => ({
      name,
      gameStages: [
        {
          elements: [{ type: "prompt", file: "notes.prompt.md", shared: true }],
        },
      ],
    });
    const file = { treatments: [t("a"), t("b")] };
    const load = loaderFrom({ "notes.prompt.md": promptFile("openResponse") });
    const report = await getRequiredServices(file, { loadPrompt: load });
    expect(report.byTreatment.a.coedit).toBe(true);
    expect(report.byTreatment.b.coedit).toBe(true);
    // Deduped across arms, not just within one arm.
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("discussion chatType maps to video / text", async () => {
    const load = loaderFrom({});
    for (const [chatType, expected] of [
      ["video", { video: true, textChat: false }],
      ["audio", { video: true, textChat: false }],
      ["text", { video: false, textChat: true }],
    ] as const) {
      const file = {
        treatments: [
          {
            gameStages: [{ name: "s", discussion: { chatType }, elements: [] }],
          },
        ],
      };
      const { overall } = await getRequiredServices(file, { loadPrompt: load });
      expect({ video: overall.video, textChat: overall.textChat }).toEqual(
        expected,
      );
    }
  });

  test("video AND text are OR-accumulated across separate discussions", async () => {
    const file = {
      treatments: [
        {
          gameStages: [
            { discussion: { chatType: "video" }, elements: [] },
            { discussion: { chatType: "text" }, elements: [] },
          ],
        },
      ],
    };
    const { overall } = await getRequiredServices(file, {
      loadPrompt: loaderFrom({}),
    });
    expect({ video: overall.video, textChat: overall.textChat }).toEqual({
      video: true,
      textChat: true,
    });
  });

  test("coedit is OR across distinct shared prompt files", async () => {
    const file = {
      treatments: [
        {
          gameStages: [
            {
              elements: [
                { type: "prompt", file: "quiz.prompt.md", shared: true },
                { type: "prompt", file: "notes.prompt.md", shared: true },
              ],
            },
          ],
        },
      ],
    };
    const load = loaderFrom({
      "quiz.prompt.md": promptFile("multipleChoice"),
      "notes.prompt.md": promptFile("openResponse"),
    });
    const report = await getRequiredServices(file, { loadPrompt: load });
    expect(report.overall.coedit).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("openResponse frontmatter with an invalid body still → coedit (loose parse)", async () => {
    // A `-` response marker is illegal for openResponse (which uses `>`), so
    // the full promptFileSchema would reject this file — but its frontmatter
    // IS openResponse, so it still requires coedit. This pins the deliberate
    // divergence from running the full schema.
    const brokenBody = `---\ntype: openResponse\n---\nBody.\n---\n- illegal marker`;
    const file = {
      treatments: [
        {
          gameStages: [
            {
              elements: [
                { type: "prompt", file: "notes.prompt.md", shared: true },
              ],
            },
          ],
        },
      ],
    };
    const load = loaderFrom({ "notes.prompt.md": brokenBody });
    const report = await getRequiredServices(file, { loadPrompt: load });
    expect(report.overall.coedit).toBe(true);
  });

  test("shared prompt with missing/unparseable frontmatter → coedit false, no throw", async () => {
    const base = {
      treatments: [
        {
          gameStages: [
            {
              elements: [{ type: "prompt", file: "p.prompt.md", shared: true }],
            },
          ],
        },
      ],
    };
    for (const source of [
      "Just body text, no frontmatter at all.",
      "---\n: : bad: :\n---\nbody",
    ]) {
      const load = loaderFrom({ "p.prompt.md": source });
      const report = await getRequiredServices(base, { loadPrompt: load });
      expect(report.overall.coedit).toBe(false);
    }
  });

  test("cyclic object graph (YAML anchor) does not overflow the walk", async () => {
    const stage: Record<string, unknown> = {
      discussion: { chatType: "video" },
      elements: [],
    };
    stage.self = stage; // cycle, as a `&anchor`/`*alias` pair would produce
    const file = { treatments: [{ name: "t", gameStages: [stage] }] };
    const report = await getRequiredServices(file, {
      loadPrompt: loaderFrom({}),
    });
    expect(report.overall.video).toBe(true);
    expect(report.byTreatment.t.video).toBe(true);
  });

  test("qualtrics element → externalSurvey; native survey does not", async () => {
    const load = loaderFrom({});
    const qualtrics = {
      treatments: [
        {
          gameStages: [
            {
              elements: [{ type: "qualtrics", url: "https://x/SV_1" }],
            },
          ],
        },
      ],
    };
    expect(
      (await getRequiredServices(qualtrics, { loadPrompt: load })).overall
        .externalSurvey,
    ).toBe(true);

    const survey = {
      treatments: [
        { gameStages: [{ elements: [{ type: "survey", surveyName: "s" }] }] },
      ],
    };
    expect(
      (await getRequiredServices(survey, { loadPrompt: load })).overall
        .externalSurvey,
    ).toBe(false);
  });

  test("intro-sequence and multi-service treatments are covered together", async () => {
    const file = {
      introSequences: [
        {
          name: "prolific",
          introSteps: [
            {
              elements: [{ type: "qualtrics", url: "https://x/SV_2" }],
            },
          ],
        },
      ],
      treatments: [
        {
          name: "t",
          gameStages: [
            {
              discussion: { chatType: "video" },
              elements: [
                { type: "prompt", file: "notes.prompt.md", shared: true },
              ],
            },
          ],
        },
      ],
    };
    const load = loaderFrom({ "notes.prompt.md": promptFile("openResponse") });
    const report = await getRequiredServices(file, { loadPrompt: load });
    expect(report.overall).toEqual({
      coedit: true,
      video: true,
      textChat: false,
      externalSurvey: true,
    });
    // The qualtrics need is attributed to the intro sequence, not the
    // treatment; coedit/video are treatment-scoped.
    expect(report.byIntroSequence.prolific).toEqual({
      ...NONE,
      externalSurvey: true,
    });
    expect(report.byTreatment.t).toEqual({
      coedit: true,
      video: true,
      textChat: false,
      externalSurvey: false,
    });
  });

  test("per-arm breakdown lets a host provision only the selected arm", async () => {
    // Pilot/control variants in one file: only `pilot` uses video + a
    // shared openResponse prompt; `control` needs nothing external.
    const file = {
      treatments: [
        {
          name: "pilot",
          gameStages: [
            {
              discussion: { chatType: "video" },
              elements: [
                { type: "prompt", file: "notes.prompt.md", shared: true },
              ],
            },
          ],
        },
        {
          name: "control",
          gameStages: [{ elements: [{ type: "display", body: "hi" }] }],
        },
      ],
    };
    const load = loaderFrom({ "notes.prompt.md": promptFile("openResponse") });
    const report = await getRequiredServices(file, { loadPrompt: load });

    // Whole-file union over-reports for a control-only launch...
    expect(report.overall).toEqual({
      coedit: true,
      video: true,
      textChat: false,
      externalSurvey: false,
    });
    expect(report.byTreatment.pilot).toEqual({
      coedit: true,
      video: true,
      textChat: false,
      externalSurvey: false,
    });
    expect(report.byTreatment.control).toEqual(NONE);

    // ...but narrowing to the launched arm(s) provisions precisely.
    const controlLaunch = mergeRequiredServices(report.byTreatment.control);
    expect(controlLaunch).toEqual(NONE);
  });

  test("a Qualtrics consent arm is keyed under byConsent (own launch axis)", async () => {
    // The top-level `consent:` collection (#481) is selected by
    // `consentName`, separately from treatments/intro sequences. A
    // narrowing host must be able to see a consent-arm Qualtrics need or
    // it would under-provision credentials for the consent survey.
    const file = {
      consent: [
        {
          name: "gdpr",
          steps: [
            { elements: [{ type: "qualtrics", url: "https://x/SV_CONSENT" }] },
          ],
        },
      ],
      treatments: [
        {
          name: "t",
          gameStages: [{ elements: [{ type: "display", body: "hi" }] }],
        },
      ],
    };
    const report = await getRequiredServices(file, {
      loadPrompt: loaderFrom({}),
    });
    expect(report.byConsent.gdpr).toEqual({ ...NONE, externalSurvey: true });
    expect(report.byTreatment.t).toEqual(NONE);
    // Whole-file default still catches it.
    expect(report.overall.externalSurvey).toBe(true);

    // A launch narrowing to treatment `t` + consent `gdpr` provisions it.
    const launch = mergeRequiredServices(
      report.byTreatment.t,
      report.byConsent.gdpr,
    );
    expect(launch.externalSurvey).toBe(true);
  });

  test("a hostile arm name (__proto__) stays an enumerable, lookup-able key", async () => {
    // nameSchema permits `__proto__`; building the map with a plain object
    // literal would rebind its prototype and hide the arm. A narrowing
    // host enumerating/looking up arms must still see it.
    const file = {
      treatments: [
        {
          name: "__proto__",
          gameStages: [{ discussion: { chatType: "video" }, elements: [] }],
        },
      ],
    };
    const report = await getRequiredServices(file, {
      loadPrompt: loaderFrom({}),
    });
    expect(Object.keys(report.byTreatment)).toContain("__proto__");
    expect(report.byTreatment["__proto__"]).toEqual({ ...NONE, video: true });
    // The map's own prototype is untouched: a missing arm is undefined,
    // not a leaked boolean, so mergeRequiredServices' filter is sound.
    expect(report.byTreatment["never_defined"]).toBeUndefined();
  });

  test("duplicate treatment names are folded (OR), not dropped", async () => {
    const file = {
      treatments: [
        {
          name: "dup",
          gameStages: [{ discussion: { chatType: "video" }, elements: [] }],
        },
        {
          name: "dup",
          gameStages: [{ discussion: { chatType: "text" }, elements: [] }],
        },
      ],
    };
    const report = await getRequiredServices(file, {
      loadPrompt: loaderFrom({}),
    });
    expect(report.byTreatment.dup).toEqual({
      ...NONE,
      video: true,
      textChat: true,
    });
  });

  test("unnamed treatments are excluded from byTreatment but still in overall", async () => {
    const file = {
      treatments: [
        { gameStages: [{ type: "qualtrics", url: "https://x/SV_9" }] },
      ],
    };
    const report = await getRequiredServices(file, {
      loadPrompt: loaderFrom({}),
    });
    expect(report.byTreatment).toEqual({});
    // overall is a genuine whole-file walk, so the stray need is still
    // caught in the safe over-provisioning direction.
    expect(report.overall.externalSurvey).toBe(true);
  });

  test("loader errors propagate rather than under-provisioning", async () => {
    const file = {
      treatments: [
        {
          name: "t",
          gameStages: [
            {
              elements: [
                { type: "prompt", file: "missing.prompt.md", shared: true },
              ],
            },
          ],
        },
      ],
    };
    const load = loaderFrom({}); // any read throws
    await expect(
      getRequiredServices(file, { loadPrompt: load }),
    ).rejects.toThrow(/missing\.prompt\.md/);
  });
});

describe("mergeRequiredServices", () => {
  test("ORs each flag across inputs and skips undefined", () => {
    expect(
      mergeRequiredServices(
        { coedit: true, video: false, textChat: false, externalSurvey: false },
        undefined,
        { coedit: false, video: true, textChat: false, externalSurvey: false },
      ),
    ).toEqual({
      coedit: true,
      video: true,
      textChat: false,
      externalSurvey: false,
    });
  });

  test("no inputs (or all undefined) → all false", () => {
    expect(mergeRequiredServices()).toEqual(NONE);
    expect(mergeRequiredServices(undefined, undefined)).toEqual(NONE);
  });

  test("consumer launch-union pattern: selected treatments + intro sequence", async () => {
    const file = {
      introSequences: [
        {
          name: "consent",
          introSteps: [
            { elements: [{ type: "qualtrics", url: "https://x/SV_C" }] },
          ],
        },
      ],
      treatments: [
        {
          name: "video_arm",
          gameStages: [{ discussion: { chatType: "video" }, elements: [] }],
        },
        {
          name: "text_arm",
          gameStages: [{ discussion: { chatType: "text" }, elements: [] }],
        },
      ],
    };
    const report = await getRequiredServices(file, {
      loadPrompt: loaderFrom({}),
    });
    // Launch = { treatments: [video_arm], introSequence: consent }.
    const launch = mergeRequiredServices(
      report.byTreatment.video_arm,
      report.byIntroSequence.consent,
    );
    expect(launch).toEqual({
      coedit: false,
      video: true,
      textChat: false, // text_arm was NOT selected, so no text chat
      externalSurvey: true, // from the consent intro sequence
    });
  });
});
