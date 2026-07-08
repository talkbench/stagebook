import { describe, expect, test, vi } from "vitest";
import { getRequiredServices } from "./getRequiredServices.js";

/**
 * Host primitive (#508): walk an expanded treatment, tell the host which
 * external services it must provision. Mirrors the injection shape of
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

describe("getRequiredServices", () => {
  test("empty / non-object input requires nothing", async () => {
    const load = loaderFrom({});
    expect(await getRequiredServices({}, { loadPrompt: load })).toEqual({
      coedit: false,
      video: false,
      textChat: false,
      externalSurvey: false,
    });
    expect(await getRequiredServices(null, { loadPrompt: load })).toEqual({
      coedit: false,
      video: false,
      textChat: false,
      externalSurvey: false,
    });
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
    const svc = await getRequiredServices(file, { loadPrompt: load });
    expect(svc.coedit).toBe(true);
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
    const svc = await getRequiredServices(file, { loadPrompt: load });
    expect(svc.coedit).toBe(false);
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
    const svc = await getRequiredServices(file, { loadPrompt: load });
    expect(svc.coedit).toBe(false);
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
    const svc = await getRequiredServices(file, { loadPrompt: load });
    expect(svc.coedit).toBe(true);
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
      const svc = await getRequiredServices(file, { loadPrompt: load });
      expect({ video: svc.video, textChat: svc.textChat }).toEqual(expected);
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
    const svc = await getRequiredServices(file, { loadPrompt: loaderFrom({}) });
    expect({ video: svc.video, textChat: svc.textChat }).toEqual({
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
    const svc = await getRequiredServices(file, { loadPrompt: load });
    expect(svc.coedit).toBe(true);
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
    const svc = await getRequiredServices(file, { loadPrompt: load });
    expect(svc.coedit).toBe(true);
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
      const svc = await getRequiredServices(base, { loadPrompt: load });
      expect(svc.coedit).toBe(false);
    }
  });

  test("cyclic object graph (YAML anchor) does not overflow the walk", async () => {
    const stage: Record<string, unknown> = {
      discussion: { chatType: "video" },
      elements: [],
    };
    stage.self = stage; // cycle, as a `&anchor`/`*alias` pair would produce
    const file = { treatments: [{ gameStages: [stage] }] };
    const svc = await getRequiredServices(file, { loadPrompt: loaderFrom({}) });
    expect(svc.video).toBe(true);
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
      (await getRequiredServices(qualtrics, { loadPrompt: load }))
        .externalSurvey,
    ).toBe(true);

    const survey = {
      treatments: [
        { gameStages: [{ elements: [{ type: "survey", surveyName: "s" }] }] },
      ],
    };
    expect(
      (await getRequiredServices(survey, { loadPrompt: load })).externalSurvey,
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
    expect(await getRequiredServices(file, { loadPrompt: load })).toEqual({
      coedit: true,
      video: true,
      textChat: false,
      externalSurvey: true,
    });
  });

  test("loader errors propagate rather than under-provisioning", async () => {
    const file = {
      treatments: [
        {
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
